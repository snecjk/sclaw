/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawEntryPath, getOpenClawProcessCwd, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { withConfigLock } from './config-mutex';
import {
    OPENCLAW_WECHAT_CHANNEL_TYPE,
    isWechatChannelType,
    normalizeOpenClawAccountId,
    toOpenClawChannelType,
} from './channel-alias';

const OPENCLAW_DIR = getOpenClawConfigDir();
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const WECHAT_PLUGIN_ID = OPENCLAW_WECHAT_CHANNEL_TYPE;
const DEFAULT_ACCOUNT_ID = 'default';
const CHANNEL_TOP_LEVEL_KEYS_TO_KEEP = new Set(['accounts', 'defaultAccount', 'enabled']);
const WECHAT_STATE_DIR = join(OPENCLAW_DIR, WECHAT_PLUGIN_ID);
const WECHAT_ACCOUNT_INDEX_FILE = join(WECHAT_STATE_DIR, 'accounts.json');
const WECHAT_ACCOUNTS_DIR = join(WECHAT_STATE_DIR, 'accounts');
const LEGACY_WECHAT_CREDENTIALS_DIR = join(OPENCLAW_DIR, 'credentials', WECHAT_PLUGIN_ID);
const LEGACY_WECHAT_SYNC_DIR = join(OPENCLAW_DIR, 'agents', 'default', 'sessions', '.openclaw-weixin-sync');

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function resolveStoredChannelType(channelType: string): string {
    return toOpenClawChannelType(channelType);
}

function deriveLegacyWeChatRawAccountId(normalizedId: string): string | undefined {
    if (normalizedId.endsWith('-im-bot')) {
        return `${normalizedId.slice(0, -7)}@im.bot`;
    }
    if (normalizedId.endsWith('-im-wechat')) {
        return `${normalizedId.slice(0, -10)}@im.wechat`;
    }
    return undefined;
}

async function readWeChatAccountIndex(): Promise<string[]> {
    try {
        const raw = await readFile(WECHAT_ACCOUNT_INDEX_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    } catch {
        return [];
    }
}

async function writeWeChatAccountIndex(accountIds: string[]): Promise<void> {
    await mkdir(WECHAT_STATE_DIR, { recursive: true });
    await writeFile(WECHAT_ACCOUNT_INDEX_FILE, JSON.stringify(accountIds, null, 2), 'utf-8');
}

async function deleteWeChatAccountState(accountId: string): Promise<void> {
    const normalizedAccountId = normalizeOpenClawAccountId(accountId);
    const legacyRawAccountId = deriveLegacyWeChatRawAccountId(normalizedAccountId);
    const candidateIds = new Set<string>([normalizedAccountId]);
    if (legacyRawAccountId) {
        candidateIds.add(legacyRawAccountId);
    }
    if (accountId.trim()) {
        candidateIds.add(accountId.trim());
    }

    for (const candidateId of candidateIds) {
        await rm(join(WECHAT_ACCOUNTS_DIR, `${candidateId}.json`), { force: true });
    }

    const existingAccountIds = await readWeChatAccountIndex();
    const nextAccountIds = existingAccountIds.filter((entry) => !candidateIds.has(entry));
    if (nextAccountIds.length !== existingAccountIds.length) {
        if (nextAccountIds.length === 0) {
            await rm(WECHAT_ACCOUNT_INDEX_FILE, { force: true });
        } else {
            await writeWeChatAccountIndex(nextAccountIds);
        }
    }
}

async function deleteWeChatState(): Promise<void> {
    await rm(WECHAT_STATE_DIR, { recursive: true, force: true });
    await rm(LEGACY_WECHAT_CREDENTIALS_DIR, { recursive: true, force: true });
    await rm(LEGACY_WECHAT_SYNC_DIR, { recursive: true, force: true });
}

function removePluginRegistration(currentConfig: OpenClawConfig, pluginId: string): boolean {
    if (!currentConfig.plugins) return false;
    let modified = false;

    if (Array.isArray(currentConfig.plugins.allow)) {
        const nextAllow = currentConfig.plugins.allow.filter((entry) => entry !== pluginId);
        if (nextAllow.length !== currentConfig.plugins.allow.length) {
            currentConfig.plugins.allow = nextAllow;
            modified = true;
        }
        if (nextAllow.length === 0) {
            delete currentConfig.plugins.allow;
        }
    }

    if (currentConfig.plugins.entries && currentConfig.plugins.entries[pluginId]) {
        delete currentConfig.plugins.entries[pluginId];
        modified = true;
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
    }

    if (
        currentConfig.plugins.enabled !== undefined
        && !currentConfig.plugins.allow?.length
        && !currentConfig.plugins.entries
    ) {
        delete currentConfig.plugins.enabled;
        modified = true;
    }

    if (Object.keys(currentConfig.plugins).length === 0) {
        delete currentConfig.plugins;
        modified = true;
    }

    return modified;
}

// ── Types ────────────────────────────────────────────────────────

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface PluginsConfig {
    entries?: Record<string, ChannelConfigData>;
    allow?: string[];
    enabled?: boolean;
    [key: string]: unknown;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    plugins?: PluginsConfig;
    commands?: Record<string, unknown>;
    bindings?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

// ── Config I/O ───────────────────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
    if (!(await fileExists(OPENCLAW_DIR))) {
        await mkdir(OPENCLAW_DIR, { recursive: true });
    }
}

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
    await ensureConfigDir();

    if (!(await fileExists(CONFIG_FILE))) {
        return {};
    }

    try {
        const content = await readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as OpenClawConfig;
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

export async function writeOpenClawConfig(config: OpenClawConfig): Promise<void> {
    await ensureConfigDir();

    try {
        // Enable graceful in-process reload authorization for SIGUSR1 flows.
        const commands =
            config.commands && typeof config.commands === 'object'
                ? { ...(config.commands as Record<string, unknown>) }
                : {};
        commands.restart = true;
        config.commands = commands;

        await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

// ── Channel operations ───────────────────────────────────────────

async function ensurePluginAllowlist(currentConfig: OpenClawConfig, channelType: string): Promise<void> {
    if (channelType === WECHAT_PLUGIN_ID) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {
                allow: [WECHAT_PLUGIN_ID],
                enabled: true,
                entries: {
                    [WECHAT_PLUGIN_ID]: { enabled: true },
                },
            };
            return;
        }

        currentConfig.plugins.enabled = true;
        const allow = Array.isArray(currentConfig.plugins.allow)
            ? currentConfig.plugins.allow as string[]
            : [];
        if (!allow.includes(WECHAT_PLUGIN_ID)) {
            currentConfig.plugins.allow = [...allow, WECHAT_PLUGIN_ID];
        }

        if (!currentConfig.plugins.entries) {
            currentConfig.plugins.entries = {};
        }
        if (!currentConfig.plugins.entries[WECHAT_PLUGIN_ID]) {
            currentConfig.plugins.entries[WECHAT_PLUGIN_ID] = {};
        }
        currentConfig.plugins.entries[WECHAT_PLUGIN_ID].enabled = true;
    }
}

function transformChannelConfig(config: ChannelConfigData): ChannelConfigData {
    return { ...config };
}

function getLegacyChannelPayload(channelSection: ChannelConfigData): ChannelConfigData {
    const payload: ChannelConfigData = {};
    for (const [key, value] of Object.entries(channelSection)) {
        if (CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key)) continue;
        payload[key] = value;
    }
    return payload;
}

function migrateLegacyChannelConfigToAccounts(
    channelSection: ChannelConfigData,
    defaultAccountId: string = DEFAULT_ACCOUNT_ID,
): void {
    const legacyPayload = getLegacyChannelPayload(channelSection);
    const legacyKeys = Object.keys(legacyPayload);
    const hasAccounts =
        Boolean(channelSection.accounts) &&
        typeof channelSection.accounts === 'object' &&
        Object.keys(channelSection.accounts as Record<string, ChannelConfigData>).length > 0;

    if (legacyKeys.length === 0) {
        if (hasAccounts && typeof channelSection.defaultAccount !== 'string') {
            channelSection.defaultAccount = defaultAccountId;
        }
        return;
    }

    if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
        channelSection.accounts = {};
    }
    const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
    const existingDefaultAccount = accounts[defaultAccountId] ?? {};

    accounts[defaultAccountId] = {
        ...(channelSection.enabled !== undefined ? { enabled: channelSection.enabled } : {}),
        ...legacyPayload,
        ...existingDefaultAccount,
    };

    channelSection.defaultAccount =
        typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
            ? channelSection.defaultAccount
            : defaultAccountId;

    for (const key of legacyKeys) {
        delete channelSection[key];
    }
}

export async function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData,
    accountId?: string,
): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;

        await ensurePluginAllowlist(currentConfig, resolvedChannelType);

        if (!currentConfig.channels) {
            currentConfig.channels = {};
        }
        if (!currentConfig.channels[resolvedChannelType]) {
            currentConfig.channels[resolvedChannelType] = {};
        }

        const channelSection = currentConfig.channels[resolvedChannelType];
        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);

        const transformedConfig = transformChannelConfig(config);

        // Write credentials into accounts.<accountId>
        if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
            channelSection.accounts = {};
        }
        const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
        channelSection.defaultAccount =
            typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                ? channelSection.defaultAccount
                : resolvedAccountId;
        accounts[resolvedAccountId] = {
            ...accounts[resolvedAccountId],
            ...transformedConfig,
            enabled: transformedConfig.enabled ?? true,
        };

        // Most OpenClaw channel plugins read the default account's credentials
        // from the top level of `channels.<type>` (e.g. channels.dingtalk.clientId),
        // not from `accounts.default`.  Mirror them there so plugins can discover
        // the credentials correctly.
        // This MUST run unconditionally (not just when saving the default account)
        // because migrateLegacyChannelConfigToAccounts() above strips top-level
        // credential keys on every invocation.  Without this, saving a non-default
        // account (e.g. a sub-agent's DingTalk bot) leaves the top-level credentials
        // missing, breaking plugins that only read from the top level.
        const mirroredAccountId =
            typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                ? channelSection.defaultAccount
                : resolvedAccountId;
        const defaultAccountData = accounts[mirroredAccountId] ?? accounts[resolvedAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
        if (defaultAccountData) {
            for (const [key, value] of Object.entries(defaultAccountData)) {
                channelSection[key] = value;
            }
        }

        await writeOpenClawConfig(currentConfig);
        logger.info('Channel config saved', {
            channelType: resolvedChannelType,
            accountId: resolvedAccountId,
            configFile: CONFIG_FILE,
            rawKeys: Object.keys(config),
            transformedKeys: Object.keys(transformedConfig),
        });
        
    });
}

/**
 * Enable a WeChat plugin account in-memory. Caller must write the config once
 * after applying any additional mutations (e.g. agent bindings).
 */
export async function applyWeChatChannelAccountEnabled(
    config: OpenClawConfig,
    accountId: string,
): Promise<void> {
    const resolvedAccountId = accountId.trim();
    if (!resolvedAccountId) {
        throw new Error('accountId is required');
    }

    await ensurePluginAllowlist(config, WECHAT_PLUGIN_ID);

    if (!config.channels) {
        config.channels = {};
    }
    if (!config.channels[WECHAT_PLUGIN_ID]) {
        config.channels[WECHAT_PLUGIN_ID] = {};
    }

    const channelSection = config.channels[WECHAT_PLUGIN_ID];
    migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);

    if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
        channelSection.accounts = {};
    }
    const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
    channelSection.defaultAccount = resolvedAccountId;
    accounts[resolvedAccountId] = {
        ...accounts[resolvedAccountId],
        enabled: true,
    };

    const accountData = accounts[resolvedAccountId];
    for (const [key, value] of Object.entries(accountData)) {
        channelSection[key] = value;
    }
}

export async function getChannelConfig(channelType: string, accountId?: string): Promise<ChannelConfigData | undefined> {
    const resolvedChannelType = resolveStoredChannelType(channelType);
    const config = await readOpenClawConfig();
    const channelSection = config.channels?.[resolvedChannelType];
    if (!channelSection) return undefined;

    const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts?.[resolvedAccountId]) {
        return accounts[resolvedAccountId];
    }

    // Backward compat: fall back to flat top-level config (legacy format without accounts)
    if (!accounts || Object.keys(accounts).length === 0) {
        return channelSection;
    }

    return undefined;
}

function extractFormValues(saved: ChannelConfigData): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(saved)) {
        if (typeof value === 'string' && key !== 'enabled') {
            values[key] = value;
        }
    }
    return values;
}

export async function getChannelFormValues(channelType: string, accountId?: string): Promise<Record<string, string> | undefined> {
    const saved = await getChannelConfig(channelType, accountId);
    if (!saved) return undefined;

    const values = extractFormValues(saved);
    return Object.keys(values).length > 0 ? values : undefined;
}

export async function deleteChannelAccountConfig(channelType: string, accountId: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        const channelSection = currentConfig.channels?.[resolvedChannelType];
        if (!channelSection) {
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
                await writeOpenClawConfig(currentConfig);
                await deleteWeChatAccountState(accountId);
            }
            return;
        }

        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
        const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
        if (!accounts?.[accountId]) return;

        delete accounts[accountId];

        if (Object.keys(accounts).length === 0) {
            delete currentConfig.channels![resolvedChannelType];
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
        } else {
            if (channelSection.defaultAccount === accountId) {
                const nextDefaultAccountId = Object.keys(accounts).sort((a, b) => {
                    if (a === DEFAULT_ACCOUNT_ID) return -1;
                    if (b === DEFAULT_ACCOUNT_ID) return 1;
                    return a.localeCompare(b);
                })[0];
                if (nextDefaultAccountId) {
                    channelSection.defaultAccount = nextDefaultAccountId;
                }
            }
            // Re-mirror default account credentials to top level after migration
            // stripped them (same rationale as saveChannelConfig).
            const mirroredAccountId =
                typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                    ? channelSection.defaultAccount
                    : DEFAULT_ACCOUNT_ID;
            const defaultAccountData = accounts[mirroredAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
            if (defaultAccountData) {
                for (const [key, value] of Object.entries(defaultAccountData)) {
                    channelSection[key] = value;
                }
            }
        }

        await writeOpenClawConfig(currentConfig);
        if (isWechatChannelType(resolvedChannelType)) {
            await deleteWeChatAccountState(accountId);
        }
        logger.info('Deleted channel account config', { channelType: resolvedChannelType, accountId });
        
    });
}

export async function deleteChannelConfig(channelType: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();

        if (currentConfig.channels?.[resolvedChannelType]) {
            delete currentConfig.channels[resolvedChannelType];
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
            await writeOpenClawConfig(currentConfig);
            if (isWechatChannelType(resolvedChannelType)) {
                await deleteWeChatState();
            }
            
        } else if (isWechatChannelType(resolvedChannelType)) {
            removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            await writeOpenClawConfig(currentConfig);
            await deleteWeChatState();
        }

    });
}

function channelHasAnyAccount(channelSection: ChannelConfigData): boolean {
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts && typeof accounts === 'object') {
        return Object.values(accounts).some((acc) => acc.enabled !== false);
    }
    return false;
}

export async function listConfiguredChannels(): Promise<string[]> {
    const config = await readOpenClawConfig();
    const channels: string[] = [];

    if (config.channels) {
        for (const channelType of Object.keys(config.channels)) {
            const section = config.channels[channelType];
            if (section.enabled === false) continue;
            if (channelHasAnyAccount(section) || Object.keys(section).length > 0) {
                channels.push(channelType);
            }
        }
    }

    return channels;
}

export interface ConfiguredChannelAccounts {
    defaultAccountId: string;
    accountIds: string[];
}

export async function listConfiguredChannelAccounts(): Promise<Record<string, ConfiguredChannelAccounts>> {
    const config = await readOpenClawConfig();
    const result: Record<string, ConfiguredChannelAccounts> = {};

    if (!config.channels) {
        return result;
    }

    for (const [channelType, section] of Object.entries(config.channels)) {
        if (!section || section.enabled === false) continue;

        const accountIds = section.accounts && typeof section.accounts === 'object'
            ? Object.keys(section.accounts).filter(Boolean)
            : [];

        let defaultAccountId = typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
            ? section.defaultAccount
            : DEFAULT_ACCOUNT_ID;
        if (accountIds.length > 0 && !accountIds.includes(defaultAccountId)) {
            defaultAccountId = accountIds.sort((a, b) => {
                if (a === DEFAULT_ACCOUNT_ID) return -1;
                if (b === DEFAULT_ACCOUNT_ID) return 1;
                return a.localeCompare(b);
            })[0];
        }

        if (accountIds.length === 0) {
            const hasAnyPayload = Object.keys(section).some((key) => !CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key));
            if (!hasAnyPayload) continue;
            result[channelType] = {
                defaultAccountId,
                accountIds: [DEFAULT_ACCOUNT_ID],
            };
            continue;
        }

        result[channelType] = {
            defaultAccountId,
            accountIds: accountIds.sort((a, b) => {
                if (a === DEFAULT_ACCOUNT_ID) return -1;
                if (b === DEFAULT_ACCOUNT_ID) return 1;
                return a.localeCompare(b);
            }),
        };
    }

    return result;
}

export async function setChannelDefaultAccount(channelType: string, accountId: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const trimmedAccountId = accountId.trim();
        if (!trimmedAccountId) {
            throw new Error('accountId is required');
        }

        const currentConfig = await readOpenClawConfig();
        const channelSection = currentConfig.channels?.[resolvedChannelType];
        if (!channelSection) {
            throw new Error(`Channel "${resolvedChannelType}" is not configured`);
        }

        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
        const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
        if (!accounts || !accounts[trimmedAccountId]) {
            throw new Error(`Account "${trimmedAccountId}" is not configured for channel "${resolvedChannelType}"`);
        }

        channelSection.defaultAccount = trimmedAccountId;

        const defaultAccountData = accounts[trimmedAccountId];
        for (const [key, value] of Object.entries(defaultAccountData)) {
            channelSection[key] = value;
        }

        await writeOpenClawConfig(currentConfig);
        logger.info('Set channel default account', { channelType: resolvedChannelType, accountId: trimmedAccountId });
    });
}

export async function deleteAgentChannelAccounts(agentId: string, ownedChannelAccounts?: Set<string>): Promise<void> {
    return withConfigLock(async () => {
        const currentConfig = await readOpenClawConfig();
        if (!currentConfig.channels) return;

        const accountId = agentId === 'main' ? DEFAULT_ACCOUNT_ID : agentId;
        let modified = false;

        for (const channelType of Object.keys(currentConfig.channels)) {
            const section = currentConfig.channels[channelType];
            migrateLegacyChannelConfigToAccounts(section, DEFAULT_ACCOUNT_ID);
            const accounts = section.accounts as Record<string, ChannelConfigData> | undefined;
            if (!accounts?.[accountId]) continue;
            if (ownedChannelAccounts && !ownedChannelAccounts.has(`${channelType}:${accountId}`)) {
                continue;
            }

            delete accounts[accountId];
            if (Object.keys(accounts).length === 0) {
                delete currentConfig.channels[channelType];
            } else {
                if (section.defaultAccount === accountId) {
                    const nextDefaultAccountId = Object.keys(accounts).sort((a, b) => {
                        if (a === DEFAULT_ACCOUNT_ID) return -1;
                        if (b === DEFAULT_ACCOUNT_ID) return 1;
                        return a.localeCompare(b);
                    })[0];
                    if (nextDefaultAccountId) {
                        section.defaultAccount = nextDefaultAccountId;
                    }
                }
                // Re-mirror default account credentials to top level after migration
                // stripped them (same rationale as saveChannelConfig).
                const mirroredAccountId =
                    typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
                        ? section.defaultAccount
                        : DEFAULT_ACCOUNT_ID;
                const defaultAccountData = accounts[mirroredAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
                if (defaultAccountData) {
                    for (const [key, value] of Object.entries(defaultAccountData)) {
                        section[key] = value;
                    }
                }
            }
            modified = true;
        }

        if (modified) {
            await writeOpenClawConfig(currentConfig);
            logger.info('Deleted all channel accounts for agent', { agentId, accountId });
        }
    });
}

export async function setChannelEnabled(channelType: string, enabled: boolean): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();

        if (isWechatChannelType(resolvedChannelType)) {
            if (enabled) {
                await ensurePluginAllowlist(currentConfig, WECHAT_PLUGIN_ID);
            } else {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
        }

        if (!currentConfig.channels) currentConfig.channels = {};
        if (!currentConfig.channels[resolvedChannelType]) currentConfig.channels[resolvedChannelType] = {};
        currentConfig.channels[resolvedChannelType].enabled = enabled;
        await writeOpenClawConfig(currentConfig);
        
    });
}

export async function cleanupDanglingWeChatPluginState(): Promise<{ cleanedDanglingState: boolean }> {
    return withConfigLock(async () => {
        const currentConfig = await readOpenClawConfig();
        // Phase 2: Host Worker owns WeChat — always strip OC openclaw-weixin plugin wiring
        // so Gateway does not dual-poll alongside the utilityProcess worker.
        let modified = removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);

        if (currentConfig.channels?.[WECHAT_PLUGIN_ID]) {
            delete currentConfig.channels[WECHAT_PLUGIN_ID];
            modified = true;
            if (Object.keys(currentConfig.channels).length === 0) {
                delete currentConfig.channels;
            }
        }

        if (Array.isArray(currentConfig.bindings)) {
            const nextBindings = (currentConfig.bindings as Array<Record<string, unknown>>).filter((binding) => {
                const match = binding.match as { channel?: string } | undefined;
                return match?.channel !== WECHAT_PLUGIN_ID;
            });
            if (nextBindings.length !== currentConfig.bindings.length) {
                currentConfig.bindings = nextBindings;
                modified = true;
            }
            if (nextBindings.length === 0) {
                delete currentConfig.bindings;
            }
        }

        if (modified) {
            await writeOpenClawConfig(currentConfig);
        }
        // Legacy OC credential tree only (Host Worker uses ~/.stoclaw/weixin).
        await deleteWeChatState();
        return { cleanedDanglingState: modified };
    });
}

// ── Validation ───────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const DOCTOR_PARSER_FALLBACK_HINT =
    'Doctor output could not be confidently interpreted; falling back to local channel config checks.';

type DoctorValidationParseResult = {
    errors: string[];
    warnings: string[];
    undetermined: boolean;
};

export function parseDoctorValidationOutput(channelType: string, output: string): DoctorValidationParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedChannelType = channelType.toLowerCase();
    const normalizedOutput = output.trim();

    if (!normalizedOutput) {
        return {
            errors,
            warnings: [DOCTOR_PARSER_FALLBACK_HINT],
            undetermined: true,
        };
    }

    const lines = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const channelLines = lines.filter((line) => line.toLowerCase().includes(normalizedChannelType));
    let classifiedCount = 0;

    for (const line of channelLines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('error') || lowerLine.includes('unrecognized key')) {
            errors.push(line);
            classifiedCount += 1;
            continue;
        }
        if (lowerLine.includes('warning')) {
            warnings.push(line);
            classifiedCount += 1;
        }
    }

    if (channelLines.length === 0 || classifiedCount === 0) {
        warnings.push(DOCTOR_PARSER_FALLBACK_HINT);
        return {
            errors,
            warnings,
            undetermined: true,
        };
    }

    return {
        errors,
        warnings,
        undetermined: false,
    };
}

export interface CredentialValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    details?: Record<string, string>;
}

export async function validateChannelCredentials(
    _channelType: string,
    _config: Record<string, string>,
): Promise<CredentialValidationResult> {
    return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
}

export async function validateChannelConfig(channelType: string): Promise<ValidationResult> {
    const { exec } = await import('child_process');
    const resolvedChannelType = resolveStoredChannelType(channelType);

    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    try {
        const openclawPath = getOpenClawProcessCwd();
        const entryScript = getOpenClawEntryPath();

        // Run openclaw doctor command to validate config (async to avoid
        // blocking the main thread). Use Electron itself as the Node runtime
        // (ELECTRON_RUN_AS_NODE) — system `node` cannot read entry scripts
        // inside the openclaw.asar archive.
        const runDoctor = async (command: string): Promise<string> =>
            await new Promise<string>((resolve, reject) => {
                exec(
                    command,
                    {
                        cwd: openclawPath,
                        encoding: 'utf-8',
                        timeout: 30000,
                        windowsHide: true,
                        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENCLAW_NO_RESPAWN: '1' },
                    },
                    (err, stdout, stderr) => {
                        const combined = `${stdout || ''}${stderr || ''}`;
                        if (err) {
                            const next = new Error(combined || err.message);
                            reject(next);
                            return;
                        }
                        resolve(combined);
                    },
                );
            });

        const output = await runDoctor(`"${process.execPath}" "${entryScript}" doctor 2>&1`);

        const parsedDoctor = parseDoctorValidationOutput(resolvedChannelType, output);
        result.errors.push(...parsedDoctor.errors);
        result.warnings.push(...parsedDoctor.warnings);
        if (parsedDoctor.errors.length > 0) {
            result.valid = false;
        }
        if (parsedDoctor.undetermined) {
            logger.warn('Doctor output parsing fell back to local channel checks', {
                channelType: resolvedChannelType,
                hint: DOCTOR_PARSER_FALLBACK_HINT,
            });
        }

        const config = await readOpenClawConfig();
        const savedChannelConfig = await getChannelConfig(resolvedChannelType, DEFAULT_ACCOUNT_ID);
        if (!config.channels?.[resolvedChannelType] || !savedChannelConfig) {
            result.errors.push(`Channel ${resolvedChannelType} is not configured`);
            result.valid = false;
        } else if (config.channels[resolvedChannelType].enabled === false) {
            result.warnings.push(`Channel ${resolvedChannelType} is disabled`);
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            result.valid = true;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Unrecognized key') || errorMessage.includes('invalid config')) {
            result.errors.push(errorMessage);
            result.valid = false;
        } else if (errorMessage.includes('ENOENT')) {
            result.errors.push('OpenClaw not found. Please ensure OpenClaw is installed.');
            result.valid = false;
        } else {
            console.warn('Doctor command failed:', errorMessage);
            const config = await readOpenClawConfig();
            if (config.channels?.[resolvedChannelType]) {
                result.valid = true;
            } else {
                result.errors.push(`Channel ${resolvedChannelType} is not configured`);
                result.valid = false;
            }
        }
    }

    return result;
}
