import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { syncClaudeSkillsForAgent } from './claude-skill-bridge';
import { listClaudeBridgePluginPaths } from './claude-plugin-bridge';
import type { ProviderAccount } from '../shared/providers/types';
import { getDefaultProviderAccountId, getProviderAccount } from './providers/provider-store';
import {
  isLegacyStoProviderAccountId,
  STO_CANONICAL_ACCOUNT_ID,
} from './providers/sto-placeholder-utils';
import { applyStoClaudeInferenceEnv } from './sto-claude-inference-env';
import { getAgentPreferredModel, getAgentWorkspacePath } from '../utils/agent-config';
import { logger } from '../utils/logger';
import { expandPath, getClaudeConfigDir } from '../utils/paths';
import { getApiKey } from '../utils/secure-storage';
import { buildClaudeRuntimeOptions } from '../engines/claude-runtime-extensions';
import type {
  ClaudeScheduledTaskDefinition,
  ClaudeTaskPermissionProfile,
} from './claude-scheduled-task-store';

export interface ClaudeTaskRuntimeContext {
  accountId?: string;
  additionalDirectories?: string[];
  agentId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string;
  pathToClaudeCodeExecutable?: string;
  permissionMode?: 'bypassPermissions';
  plugins: Array<{ type: 'local'; path: string }>;
  runtimeOptions: Awaited<ReturnType<typeof buildClaudeRuntimeOptions>>;
  sessionKey: string;
  sessionId: string;
}

async function resolveTaskWorkspacePath(definition: ClaudeScheduledTaskDefinition): Promise<string> {
  const configured = definition.workspacePath?.trim();
  if (configured) {
    const expanded = expandPath(configured);
    if (existsSync(expanded)) {
      return expanded;
    }
    logger.warn('[claude-task] configured workspace path does not exist, falling back to agent workspace', {
      taskId: definition.id,
      agentId: definition.agentId,
      workspacePath: configured,
      expandedWorkspacePath: expanded,
    });
  }

  const agentWorkspace = await getAgentWorkspacePath(definition.agentId);
  if (agentWorkspace) {
    return agentWorkspace;
  }

  if (configured) {
    return expandPath(configured);
  }

  throw new Error(`Claude task ${definition.id} is missing workspace path`);
}

function buildAdditionalDirectories(cwd: string): string[] {
  const directories = new Set<string>();
  const userHome = expandPath('~') || homedir();
  const normalizedCwd = cwd.trim();
  const normalizedHome = userHome.trim();

  if (normalizedHome && normalizedHome !== normalizedCwd) {
    directories.add(normalizedHome);
  }

  return [...directories];
}

let claudeConfigEnvQueue: Promise<void> = Promise.resolve();
let ensureClaudeConfigDirPromise: Promise<void> | null = null;

function getBundledClaudeExecutablePath(): string | undefined {
  if (!process.resourcesPath) return undefined;

  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const packageName = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const candidate = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    packageName,
    binaryName,
  );

  return existsSync(candidate) ? candidate : undefined;
}

async function ensureClaudeConfigDir(): Promise<void> {
  if (ensureClaudeConfigDirPromise) {
    await ensureClaudeConfigDirPromise;
    return;
  }
  ensureClaudeConfigDirPromise = mkdir(getClaudeConfigDir(), { recursive: true })
    .catch((error) => {
      logger.warn('Failed to ensure Claude config directory:', error);
    })
    .then(() => {});
  await ensureClaudeConfigDirPromise;
}

async function withClaudeConfigDirEnv<T>(configDir: string, task: () => Promise<T>): Promise<T> {
  const next = claudeConfigEnvQueue.then(async () => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      return await task();
    } finally {
      if (typeof previous === 'string') {
        process.env.CLAUDE_CONFIG_DIR = previous;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    }
  });

  claudeConfigEnvQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function sanitizeClaudeSettingsEnv(): Promise<void> {
  const settingsPath = join(getClaudeConfigDir(), 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings.env as Record<string, unknown> | undefined;
    if (!env || typeof env !== 'object') return;

    let changed = false;
    for (const key of Object.keys(env)) {
      if (key.startsWith('ANTHROPIC_')) {
        delete env[key];
        changed = true;
      }
    }

    if (changed) {
      settings.env = env;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      logger.info('[claude-task] stripped ANTHROPIC_* env vars from settings.json');
    }
  } catch {
    // Ignore missing or unreadable settings.
  }
}

async function resolveStoCatalogAccountId(): Promise<string | undefined> {
  const account = await getProviderAccount(STO_CANONICAL_ACCOUNT_ID);
  return account?.vendorId === 'sto' ? STO_CANONICAL_ACCOUNT_ID : undefined;
}

async function normalizeClaudeTaskAccountId(
  accountId: string | undefined,
  model: string | undefined,
  agentId: string,
): Promise<string | undefined> {
  const stoId = await resolveStoCatalogAccountId();
  if (!stoId) {
    return accountId?.trim() || undefined;
  }

  const trimmed = accountId?.trim();
  const hasModel = Boolean(model?.trim());

  if (!trimmed && hasModel) {
    logger.info('[claude-task] defaulting accountId to sto (model set, account missing)', { agentId });
    return stoId;
  }

  if (isLegacyStoProviderAccountId(trimmed)) {
    logger.info('[claude-task] normalized legacy accountId to sto', { agentId, from: trimmed });
    return stoId;
  }

  if (trimmed) {
    const account = await getProviderAccount(trimmed);
    if (!account) {
      logger.info('[claude-task] accountId not found, falling back to sto', { agentId, from: trimmed });
      return stoId;
    }
    return trimmed;
  }

  if (!hasModel) {
    return stoId;
  }

  return undefined;
}

function resolveModelFromStoCatalog(
  model: string | undefined,
  stoAccount: ProviderAccount | null,
): string | undefined {
  const catalog = (stoAccount?.metadata?.customModels as string[] | undefined) ?? [];
  const fallback = stoAccount?.model?.trim() || catalog[0];

  const trimmed = model?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (!stoAccount) {
    return trimmed;
  }

  if (catalog.includes(trimmed)) {
    return trimmed;
  }

  const suffixHit = catalog.find(
    (catalogId) => catalogId === trimmed
      || catalogId.endsWith(`/${trimmed}`)
      || trimmed.endsWith(`/${catalogId}`),
  );
  // Delisted / renamed models must not keep running; fall back to workspace default.
  return suffixHit ?? fallback ?? trimmed;
}

async function buildClaudeEnvForAccount(accountId?: string): Promise<NodeJS.ProcessEnv> {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: getClaudeConfigDir(),
  };

  let resolvedAccountId = accountId?.trim();
  let account = resolvedAccountId ? await getProviderAccount(resolvedAccountId) : null;

  if (!account) {
    const stoId = await resolveStoCatalogAccountId();
    if (stoId) {
      account = await getProviderAccount(stoId);
      resolvedAccountId = stoId;
    }
  }

  if (!account || !resolvedAccountId) {
    return base;
  }

  if (account.vendorId === 'sto') {
    await applyStoClaudeInferenceEnv(base, account);
    return base;
  }

  const apiKey = await getApiKey(resolvedAccountId);
  if (account.baseUrl) {
    base.ANTHROPIC_BASE_URL = account.baseUrl;
  }
  if (apiKey) {
    base.ANTHROPIC_API_KEY = apiKey;
    base.ANTHROPIC_AUTH_TOKEN = apiKey;
  }

  return base;
}

async function resolveLaunchSelection(definition: ClaudeScheduledTaskDefinition): Promise<{
  accountId?: string;
  model?: string;
}> {
  let accountId = definition.providerAccountId;
  let model = definition.model;

  const preferred = await getAgentPreferredModel(definition.agentId);
  accountId = accountId ?? preferred.accountId ?? await getDefaultProviderAccountId();
  model = model ?? preferred.model;

  accountId = await normalizeClaudeTaskAccountId(accountId, model, definition.agentId);

  const account = accountId ? await getProviderAccount(accountId) : null;

  if (!model && account) {
    model = account.model;
  }

  if (account?.vendorId === 'sto') {
    model = resolveModelFromStoCatalog(model, account);
  }

  return { accountId, model };
}

function mapPermissionProfile(
  permissionProfile: ClaudeTaskPermissionProfile,
): 'bypassPermissions' | undefined {
  return permissionProfile === 'dangerous-bypass' ? 'bypassPermissions' : undefined;
}

export async function buildClaudeTaskRuntimeContext(
  definition: ClaudeScheduledTaskDefinition,
  run: {
    runId: string;
    sessionKey: string;
    sessionId: string;
  },
): Promise<ClaudeTaskRuntimeContext> {
  await ensureClaudeConfigDir();
  await sanitizeClaudeSettingsEnv();

  const cwd = await resolveTaskWorkspacePath(definition);

  const launch = await resolveLaunchSelection(definition);
  await syncClaudeSkillsForAgent(definition.agentId, cwd).catch((error) => {
    logger.warn('[claude-task] failed to sync Claude skills before run', error);
  });

  const pluginPaths = await listClaudeBridgePluginPaths();
  const runtimeOptions = await withClaudeConfigDirEnv(getClaudeConfigDir(), async () => (
    buildClaudeRuntimeOptions(run.sessionKey)
  ));

  return {
    accountId: launch.accountId,
    additionalDirectories: buildAdditionalDirectories(cwd),
    agentId: definition.agentId,
    cwd,
    env: await buildClaudeEnvForAccount(launch.accountId),
    model: launch.model,
    pathToClaudeCodeExecutable: getBundledClaudeExecutablePath(),
    permissionMode: mapPermissionProfile(definition.permissionProfile),
    plugins: pluginPaths.map((pluginPath) => ({
      type: 'local' as const,
      path: pluginPath,
    })),
    runtimeOptions,
    sessionKey: run.sessionKey,
    sessionId: run.sessionId,
  };
}
