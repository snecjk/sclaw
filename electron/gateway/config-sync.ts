import { app } from 'electron';
import path, { join } from 'path';
import { getAgentWorkspacePath } from '../utils/agent-config';
import { existsSync, readFileSync, cpSync, mkdirSync, rmSync } from 'fs';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import {
  getOpenClawDir,
  getOpenClawEntryPath,
  getOpenClawConfigDir,
  getOpenClawProcessCwd,
  getOpenClawNodeModulesPath,
  getOpenClawPackageRootEnv,
  getBundledPluginSourceCandidates,
  isOpenClawPresent,
  getDefaultAgentWorkspacePath,
  ensureWorkspaceArtifactOutputDir,
} from '../utils/paths';
import { WORKSPACE_ARTIFACT_OUTPUT_DIRNAME } from '../../shared/workspace-paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannels } from '../utils/channel-config';
import {
  syncGatewayTokenToConfig,
  syncBrowserConfigToOpenClaw,
  syncSessionIdleMinutesToOpenClaw,
  sanitizeOpenClawConfig,
  syncStoPluginsToOpenClaw,
} from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { getDwsBinDir } from '../utils/dws-cli';
import { getQpathBinDir } from '../utils/qpath-cli';
import { prependPathEntry, prependNodePathEntry } from '../utils/env-path';
import { resolveConnectedGitlabHostname } from '../connectors/agent-context';
import { copyPluginFromNodeModules, fixupPluginManifest } from '../utils/plugin-install';
import { SAI_CLIENT_ID_VALUE, applySaiClientIdEnv } from '../utils/sai-client-id';
import { prepareWorkflowOpenClawRuntimeForGatewayLaunch } from '../services/workflow-runtime/agent-runner-openclaw';

export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  qqbot: { dirName: 'qqbot', npmName: '@sliverp/qqbot' },
  'openclaw-weixin': { dirName: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin' },
};

function _readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function buildBundledPluginSources(pluginDirName: string): string[] {
  return getBundledPluginSourceCandidates(pluginDirName);
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * - Packaged mode: uses bundled plugins from resources/ (includes deps)
 * - Dev mode: falls back to node_modules/ with pnpm-aware dep collection
 */
async function readPluginVersionAsync(pkgJsonPath: string): Promise<string | null> {
  try {
    const { readFile } = await import('fs/promises');
    const raw = await readFile(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): Promise<void> {
  await Promise.all(
    configuredChannels.map(async (channelType) => {
      const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
      if (!pluginInfo) return;
      const { dirName, npmName } = pluginInfo;

      const targetDir = join(getOpenClawConfigDir(), 'extensions', dirName);
      const targetManifest = join(targetDir, 'openclaw.plugin.json');
      const isInstalled = existsSync(fsPath(targetManifest));
      const installedVersion = isInstalled
        ? await readPluginVersionAsync(join(targetDir, 'package.json'))
        : null;

      // Try bundled sources first (packaged mode or if bundle-plugins was run)
      const bundledSources = buildBundledPluginSources(dirName);
      const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

      if (bundledDir) {
        const sourceVersion = await readPluginVersionAsync(join(bundledDir, 'package.json'));
        // Install or upgrade if version differs or plugin not installed
        if (!isInstalled || (sourceVersion && installedVersion && sourceVersion !== installedVersion)) {
          logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (bundled)`);
          try {
            mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
            rmSync(fsPath(targetDir), { recursive: true, force: true });
            cpSync(fsPath(bundledDir), fsPath(targetDir), { recursive: true, dereference: true });
            fixupPluginManifest(targetDir);
          } catch (err) {
            logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin:`, err);
          }
        }
        return;
      }

      // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
      if (!app.isPackaged) {
        const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
        if (!existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) return;
        const sourceVersion = await readPluginVersionAsync(join(npmPkgPath, 'package.json'));
        if (!sourceVersion) return;
        // Skip only if installed AND same version
        if (isInstalled && installedVersion && sourceVersion === installedVersion) return;

        logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`);
        try {
          mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
          copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
          fixupPluginManifest(targetDir);
        } catch (err) {
          logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin from node_modules:`, err);
        }
      }
    })
  );
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  // Group 1: independent config syncs that can run in parallel
  await Promise.all([
    syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true }),
    sanitizeOpenClawConfig().catch((err) => {
      logger.warn('Failed to sanitize openclaw.json:', err);
    }),
    cleanupDanglingWeChatPluginState().catch((err) => {
      logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
    }),
  ]);

  // Group 2: plugin auto-upgrade (needs channel list)
  try {
    const configuredChannels = await listConfiguredChannels();
    await ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  // Group 3: independent token / browser / idle syncs
  await Promise.all([
    syncGatewayTokenToConfig(appSettings.gatewayToken).catch((err) => {
      logger.warn('Failed to sync gateway token to openclaw.json:', err);
    }),
    syncBrowserConfigToOpenClaw().catch((err) => {
      logger.warn('Failed to sync browser config to openclaw.json:', err);
    }),
    syncSessionIdleMinutesToOpenClaw().catch((err) => {
      logger.warn('Failed to sync session idle minutes to openclaw.json:', err);
    }),
  ]);

  // Group 4: STO plugin stubs before Gateway spawn — including on the login page —
  // so post-login syncStoPluginsToOpenClaw is typically a no-op and does not
  // trigger an OpenClaw hard restart (WS 1012) after the user signs in.
  try {
    const wrote = await syncStoPluginsToOpenClaw();
    if (wrote) {
      logger.info('Pre-launch STO plugins config written to openclaw.json');
    }
  } catch (err) {
    logger.warn('Failed to sync STO plugins before launch:', err);
  }

  // Group 5: authenticated setup (SSO / models)
  try {
    const { getAuthState, getStoToken } = await import('../utils/auth-store');
    const { runAuthenticatedSetup } = await import('../services/auth-setup-orchestrator');
    const [authState, token] = await Promise.all([getAuthState(), getStoToken()]);
    if (authState.isAuthenticated && token) {
      await runAuthenticatedSetup({
        source: 'startup',
        skipGatewayRefresh: true,
      });
    }
  } catch (err) {
    logger.warn('Pre-launch authenticated setup failed:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const configuredChannels = await listConfiguredChannels();
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawPackageDir = getOpenClawDir();
  const openclawDir = getOpenClawProcessCwd();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawPackageDir}`);
  }

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  // The workflow runtime is a fixed Gateway agent. It must exist before the
  // child process reads the agent registry; workflow execution must never
  // reload/restart a live Gateway merely to register this agent.
  await prepareWorkflowOpenClawRuntimeForGatewayLaunch();

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();
  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  applySaiClientIdEnv(process.env as Record<string, string | undefined>);
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  let baseEnvPatched = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  baseEnvPatched = prependPathEntry(baseEnvPatched, getDwsBinDir()).env;
  baseEnvPatched = prependPathEntry(baseEnvPatched, getQpathBinDir()).env;

  const mainWorkspace = await getAgentWorkspacePath('main')
    ?? getDefaultAgentWorkspacePath();
  const mainOutputDir = ensureWorkspaceArtifactOutputDir(mainWorkspace)
    ?? join(mainWorkspace, WORKSPACE_ARTIFACT_OUTPUT_DIRNAME);

  const gitlabHost = resolveConnectedGitlabHostname();
  const forkEnv: Record<string, string | undefined> = prependNodePathEntry({
    ...baseEnvPatched,
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
    OPENCLAW_STATE_DIR: getOpenClawConfigDir(),
    OPENCLAW_PACKAGE_ROOT: getOpenClawPackageRootEnv(),
    // 定时任务已统一到 StoClaw ScheduledTaskScheduler（SQLite schedule_tasks）。
    // 禁用 Gateway 内置 CronService，避免迁移后 jobs.json 残留导致双调度。
    OPENCLAW_SKIP_CRON: '1',
    STOCLAW_WORKSPACE: mainWorkspace,
    STOCLAW_OUTPUT_DIR: mainOutputDir,
    SAI_CLIENT_ID: SAI_CLIENT_ID_VALUE,
    ...(gitlabHost ? { GITLAB_HOST: gitlabHost } : {}),
  }, getOpenClawNodeModulesPath());

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
