import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_MODEL_CONTEXT_WINDOW } from '../../shared/model-runtime-defaults';
import type { ProviderAccount } from '../shared/providers/types';
import { getProviderAccount } from '../services/providers/provider-store';
import {
  isLegacyStoProviderAccountId,
  STO_CANONICAL_ACCOUNT_ID,
} from '../services/providers/sto-placeholder-utils';
import { applyStoClaudeInferenceEnv } from '../services/sto-claude-inference-env';
import { getAgentPreferredModel } from '../utils/agent-config';
import { getDwsBinDir } from '../utils/dws-cli';
import { getQpathBinDir } from '../utils/qpath-cli';
import { prependPathEntry } from '../utils/env-path';
import { resolveConnectedGitlabHostname } from '../connectors/agent-context';
import { isBinaryAllowedByConnectors } from '../connectors/gateway-allowlist';
import { logger } from '../utils/logger';
import { getClaudeConfigDir } from '../utils/paths';
import { applySaiClientIdEnv } from '../utils/sai-client-id';
import { getApiKey } from '../utils/secure-storage';
import { resolveAvailableClaudeModel } from './claude-model-selection';

type ClaudeAgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');
export type ClaudeQueryInput = Parameters<ClaudeAgentSdk['query']>[0];

export interface ClaudeQueryDiagnostics {
  sessionKey: string;
  runId: string;
  mode: 'new' | 'resume' | 'recovery';
}

export interface ClaudeLaunchSelection {
  accountId: string;
  fallbackApplied: boolean;
  model: string;
  provider?: string;
}

export interface PreparedClaudeRuntime {
  configDir: string;
  env: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable?: string;
  selection: ClaudeLaunchSelection;
}

let claudeConfigEnvQueue: Promise<void> = Promise.resolve();
let ensureClaudeConfigDirPromise: Promise<void> | null = null;
let claudeSdkPromise: Promise<ClaudeAgentSdk> | null = null;

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

async function loadClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  claudeSdkPromise ??= import('@anthropic-ai/claude-agent-sdk');
  return claudeSdkPromise;
}

export async function ensureClaudeRuntimeReady(): Promise<void> {
  if (!ensureClaudeConfigDirPromise) {
    ensureClaudeConfigDirPromise = mkdir(getClaudeConfigDir(), { recursive: true })
      .catch((error) => {
        logger.warn('[claude-runtime] Failed to ensure Claude config directory:', error);
      })
      .then(() => undefined);
  }
  await ensureClaudeConfigDirPromise;
  await sanitizeClaudeSettingsEnv();
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
      logger.info('[claude-runtime] Stripped ANTHROPIC_* env vars from settings.json');
    }
  } catch {
    // settings.json is optional; an absent or unreadable file needs no cleanup.
  }
}

export async function withClaudeConfigDirEnv<T>(
  task: () => Promise<T>,
  configDir = getClaudeConfigDir(),
): Promise<T> {
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

async function buildClaudeEnvForAccount(
  accountId: string,
  account?: ProviderAccount | null,
): Promise<NodeJS.ProcessEnv> {
  let base: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: getClaudeConfigDir(),
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT:
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT || '300000',
    // Claude Code falls back to 200K for unrecognized Anthropic-compatible
    // models. Keep its context accounting and auto-compaction threshold aligned
    // with the shared runtime default until provider model metadata is wired in.
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(DEFAULT_MODEL_CONTEXT_WINDOW),
  };
  // Connector CLIs: only inject PATH when the connector is connected (Gateway parity).
  if (isBinaryAllowedByConnectors('dws')) {
    base = prependPathEntry(base as Record<string, string | undefined>, getDwsBinDir()).env;
  }
  if (isBinaryAllowedByConnectors('qpath')) {
    base = prependPathEntry(base as Record<string, string | undefined>, getQpathBinDir()).env;
  }
  applySaiClientIdEnv(base as Record<string, string | undefined>);
  const gitlabHost = resolveConnectedGitlabHostname();
  if (gitlabHost) {
    base.GITLAB_HOST = gitlabHost;
  }
  const resolvedAccount = account ?? await getProviderAccount(accountId);
  if (!resolvedAccount) return base;

  if (resolvedAccount.vendorId === 'sto') {
    await applyStoClaudeInferenceEnv(base, resolvedAccount);
    return base;
  }

  const apiKey = await getApiKey(accountId);
  if (resolvedAccount.baseUrl) {
    base.ANTHROPIC_BASE_URL = resolvedAccount.baseUrl;
  }
  if (apiKey) {
    base.ANTHROPIC_API_KEY = apiKey;
    base.ANTHROPIC_AUTH_TOKEN = apiKey;
  }
  logger.info('[claude-runtime] Prepared provider environment', {
    accountId,
    provider: resolvedAccount.vendorId,
    baseUrl: resolvedAccount.baseUrl ?? '(default)',
  });
  return base;
}

export async function resolveClaudeLaunchSelection(input: {
  agentId: string;
  requestedAccountId?: string;
  requestedModel?: string;
}): Promise<ClaudeLaunchSelection> {
  const preferred = await getAgentPreferredModel(input.agentId);
  let requestedAccountId = input.requestedAccountId ?? preferred.accountId;
  const requestedModel = input.requestedModel ?? preferred.model;
  if (isLegacyStoProviderAccountId(requestedAccountId)) {
    const stoAccount = await getProviderAccount(STO_CANONICAL_ACCOUNT_ID);
    if (stoAccount?.vendorId === 'sto') {
      logger.info('[claude-runtime] Normalized legacy STO account id', {
        agentId: input.agentId,
        from: requestedAccountId,
        to: STO_CANONICAL_ACCOUNT_ID,
      });
      requestedAccountId = STO_CANONICAL_ACCOUNT_ID;
    }
  }
  const selection = await resolveAvailableClaudeModel({ requestedAccountId, requestedModel });
  const account = await getProviderAccount(selection.accountId);

  if (selection.fallbackApplied) {
    logger.warn('[claude-runtime] Requested model is unavailable; using fallback', {
      agentId: input.agentId,
      requestedAccountId,
      requestedModel,
      selectedAccountId: selection.accountId,
      selectedModel: selection.model,
    });
  }

  return {
    ...selection,
    provider: account?.vendorId,
  };
}

export async function prepareClaudeRuntime(input: {
  agentId: string;
  requestedAccountId?: string;
  requestedModel?: string;
}): Promise<PreparedClaudeRuntime> {
  await ensureClaudeRuntimeReady();
  const selection = await resolveClaudeLaunchSelection(input);
  const account = await getProviderAccount(selection.accountId);
  return {
    configDir: getClaudeConfigDir(),
    env: await buildClaudeEnvForAccount(selection.accountId, account),
    pathToClaudeCodeExecutable: getBundledClaudeExecutablePath(),
    selection,
  };
}

export async function createClaudeQuery(
  input: ClaudeQueryInput,
  diagnostics?: ClaudeQueryDiagnostics,
) {
  const requestedAt = Date.now();
  const logTiming = (stage: string, stageStartedAt = requestedAt) => {
    if (!diagnostics) return;
    logger.info('[claude-runtime][query-timing]', {
      stage,
      sessionKey: diagnostics.sessionKey,
      runId: diagnostics.runId,
      mode: diagnostics.mode,
      stageMs: Date.now() - stageStartedAt,
      totalMs: Date.now() - requestedAt,
    });
  };

  await ensureClaudeRuntimeReady();
  logTiming('runtime_ready');
  const query = await withClaudeConfigDirEnv(async () => {
    logTiming('config_env_entered');
    const sdkLoadStartedAt = Date.now();
    const sdk = await loadClaudeAgentSdk();
    logTiming('sdk_loaded', sdkLoadStartedAt);
    const sdkQueryStartedAt = Date.now();
    const createdQuery = sdk.query(input);
    logTiming('sdk_query_returned', sdkQueryStartedAt);
    return createdQuery;
  });
  logTiming('config_env_released');
  return query;
}

export async function getClaudeSessionMessages(sessionId: string, cwd: string) {
  await ensureClaudeRuntimeReady();
  return withClaudeConfigDirEnv(async () => {
    const sdk = await loadClaudeAgentSdk();
    return sdk.getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: false });
  });
}

export async function deleteClaudeSdkSession(sessionId: string, cwd: string): Promise<void> {
  await ensureClaudeRuntimeReady();
  await withClaudeConfigDirEnv(async () => {
    const sdk = await loadClaudeAgentSdk();
    await sdk.deleteSession(sessionId, { dir: cwd });
  });
}
