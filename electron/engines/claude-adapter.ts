import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { syncClaudeSkillsForAgent } from '../services/claude-skill-bridge';
import { getDefaultProviderAccountId, getProviderAccount } from '../services/providers/provider-store';
import { StoModelSyncService } from '../services/providers/sto-model-sync';
import { getAgentPreferredModel, getAgentWorkspacePath } from '../utils/agent-config';
import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { getClaudeConfigDir } from '../utils/paths';
import { getApiKey } from '../utils/secure-storage';
import { buildClaudeRuntimeOptions } from './claude-runtime-extensions';
import { listClaudeBridgePluginPaths } from '../services/claude-plugin-bridge';
import { deleteEngineSessionRegistryEntry, getEngineSessionRegistryEntry, listEngineSessionRegistryEntries, upsertEngineSessionRegistryEntry, type EngineSessionRegistryEntry } from './session-registry';
import type { EngineAdapter, EngineAdapterContext, EngineHistoryResult, EngineSessionSummary } from './types';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources';

/**
 * Minimal event sink used to forward Claude streaming events to the renderer.
 * Backed at runtime by the GatewayManager EventEmitter (see EngineAdapterContext),
 * which bridges `chat:message` / `notification` events to the same IPC broadcast
 * the OpenClaw Gateway uses — so the renderer's existing state machine handles
 * them without any renderer-side changes.
 */
type ClaudeEventSink = {
  emit(event: string, payload: unknown): boolean;
};

type ActiveClaudeQuery = {
  close: () => void;
  runId: string;
  sessionId: string;
  sessionKey: string;
};

const activeClaudeQueries = new Map<string, ActiveClaudeQuery>();
const liveClaudeMessages = new Map<string, Array<{
  id: string;
  role: 'user' | 'assistant' | 'toolresult';
  content: unknown;
  timestamp?: number;
  isError?: boolean;
  toolCallId?: string;
  toolName?: string;
  receivedAt: number;
}>>();
const claudeRuntimeResults = new Map<string, NonNullable<EngineHistoryResult['runtimeResult']>>();
let claudeConfigEnvQueue: Promise<void> = Promise.resolve();
const CLAUDE_VISION_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

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

async function buildClaudeEnvForAccount(accountId?: string): Promise<NodeJS.ProcessEnv> {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: getClaudeConfigDir(),
  };

  if (!accountId) {
    logger.debug('[claude-env] No accountId, returning base env');
    return base;
  }

  const account = await getProviderAccount(accountId);
  if (!account) {
    logger.debug(`[claude-env] Account "${accountId}" not found`);
    return base;
  }

  if (account.vendorId === 'sto') {
    const token = await getStoToken();
    const ssoEnv = await getSsoEnvironment();
    const domain = StoModelSyncService.resolveDomain(ssoEnv);
    if (token) {
      const baseUrl = `${domain}/v1/anthropic`;
      base.ANTHROPIC_BASE_URL = baseUrl;
      base.ANTHROPIC_API_KEY = token;
      base.ANTHROPIC_AUTH_TOKEN = token;
      logger.info(`[claude-env] STO provider: base_url=${baseUrl}`);
    } else {
      logger.warn('[claude-env] STO provider but no stoToken available');
    }
    return base;
  }

  // Generic: use account's baseUrl + stored API key for Anthropic-compatible providers
  const apiKey = await getApiKey(accountId);
  if (account.baseUrl) {
    base.ANTHROPIC_BASE_URL = account.baseUrl;
  }
  if (apiKey) {
    base.ANTHROPIC_API_KEY = apiKey;
    base.ANTHROPIC_AUTH_TOKEN = apiKey;
  }
  logger.info(`[claude-env] Provider "${account.vendorId}": base_url=${account.baseUrl ?? '(default)'}`);

  return base;
}

async function resolveClaudeLaunchSelection(
  agentId: string,
  existing?: {
    model?: string;
    accountId?: string;
  } | null,
): Promise<{ model?: string; accountId?: string }> {
  const preferredModel = await getAgentPreferredModel(agentId);
  // Session-level override wins when the user switched models inside an active dialog.
  let model = existing?.model ?? preferredModel.model;
  let accountId = existing?.accountId ?? preferredModel.accountId;

  if (!accountId) {
    accountId = await getDefaultProviderAccountId();
  }

  if (!model && accountId) {
    const account = await getProviderAccount(accountId);
    model = account?.model;
  }

  return { model, accountId };
}

/**
 * Strip ANTHROPIC_* env vars from settings.json so they don't override
 * the dynamically injected values from buildClaudeEnvForAccount().
 * The Claude Agent SDK loads settings.json env AFTER receiving the
 * process env, which can overwrite our ANTHROPIC_BASE_URL / API_KEY.
 */
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
      logger.info('[claude-settings] Stripped ANTHROPIC_* env vars from settings.json');
    }
  } catch {
    // settings.json doesn't exist or is unreadable — nothing to sanitize
  }
}

let ensureClaudeConfigDirPromise: Promise<void> | null = null;

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

async function resolveClaudeSessionConfigDir(
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  await ensureClaudeConfigDir();
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const configDir = getClaudeConfigDir();
  const info = await withClaudeConfigDirEnv(configDir, async () => (
    sdk.getSessionInfo(sessionId, { dir: cwd })
  )).catch(() => undefined);
  return info ? configDir : null;
}

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isPathWithinDirectory(targetPath: string, rootPath: string): boolean {
  const resolvedRoot = resolve(rootPath);
  const resolvedTarget = resolve(targetPath);
  const pathRelative = relative(resolvedRoot, resolvedTarget);
  if (!pathRelative) return true;
  return !pathRelative.startsWith('..') && !pathRelative.startsWith(`..${sep}`);
}

function getAdditionalDirectories(cwd: string, media: Array<{ filePath: string }>): string[] {
  const directories = new Set<string>();
  for (const item of media) {
    const parentDir = resolve(dirname(item.filePath));
    if (!isPathWithinDirectory(parentDir, cwd)) {
      directories.add(parentDir);
    }
  }
  return [...directories];
}

function toClaudePromptStream(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      yield message;
    },
  };
}

function buildClaudeUserMessageFromContent(
  content: Array<ImageBlockParam | TextBlockParam>,
): SDKUserMessage {
  const message: MessageParam = {
    role: 'user',
    content,
  };

  return {
    type: 'user',
    message,
    parent_tool_use_id: null,
  };
}

async function buildClaudeUserMessage(
  text: string,
  media: Array<{ filePath: string; mimeType: string; fileName: string }>,
): Promise<SDKUserMessage> {
  const content: Array<ImageBlockParam | TextBlockParam> = [];
  const fallbackRefs: string[] = [];

  for (const item of media) {
    if (CLAUDE_VISION_MIME_TYPES.has(item.mimeType)) {
      const fileBuffer = await readFile(item.filePath);
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: item.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: fileBuffer.toString('base64'),
        },
      });
      continue;
    }

    fallbackRefs.push(`[media attached: ${resolve(item.filePath)} (${item.mimeType}) | ${resolve(item.filePath)}]`);
  }

  const textParts = [text.trim(), fallbackRefs.join('\n')].filter(Boolean);
  if (textParts.length > 0) {
    content.push({
      type: 'text',
      text: textParts.join('\n\n'),
    });
  }

  if (content.length === 0) {
    content.push({
      type: 'text',
      text: '(file attached)',
    });
  }

  return buildClaudeUserMessageFromContent(content);
}

function stringifyClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const part = block as Record<string, unknown>;
      if (typeof part.text === 'string') return part.text;
      if (typeof part.thinking === 'string') return part.thinking;
      if (typeof part.type === 'string' && part.type === 'tool_use' && typeof part.name === 'string') {
        return `[tool_use:${part.name}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function formatClaudeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function cacheClaudeErrorMessage(sessionKey: string, error: unknown): void {
  const current = liveClaudeMessages.get(sessionKey) ?? [];
  liveClaudeMessages.set(sessionKey, [
    ...current,
    {
      id: randomUUID(),
      role: 'assistant',
      content: `[Claude error] ${formatClaudeError(error)}`,
      timestamp: Date.now(),
      isError: true,
      receivedAt: Date.now(),
    },
  ]);
}

function toRawContentFromClaudeMessage(message: unknown): unknown {
  if (!message || typeof message !== 'object') return '';
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.content === 'string') return candidate.content;
  if (Array.isArray(candidate.content)) {
    return candidate.content.map((block) => {
      if (!block || typeof block !== 'object') return { type: 'text', text: '' };
      const source = block as Record<string, unknown>;
      if (source.type === 'text') {
        return { type: 'text', text: typeof source.text === 'string' ? source.text : '' };
      }
      if (source.type === 'thinking') {
        return { type: 'thinking', thinking: typeof source.thinking === 'string' ? source.thinking : '' };
      }
      if (source.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: source.id,
          name: source.name,
          input: source.input,
        };
      }
      if (source.type === 'tool_result') {
        return {
          type: 'tool_result',
          content: source.content,
        };
      }
      return block;
    });
  }
  return stringifyClaudeContent(candidate.content);
}

function extractClaudeMessageBlocks(message: unknown): Array<Record<string, unknown>> {
  if (!message || typeof message !== 'object') return [];
  const candidate = message as Record<string, unknown>;
  if (!Array.isArray(candidate.content)) return [];
  return candidate.content.filter((block): block is Record<string, unknown> => (
    Boolean(block) && typeof block === 'object'
  ));
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === 'string') {
      parts.push(record.text);
    } else if (typeof record.content === 'string') {
      parts.push(record.content);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

function extractWorkflowToolResult(message: unknown): {
  content: string;
  toolCallId?: string;
  toolName?: string;
} | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as Record<string, unknown>;
  const blocks = Array.isArray(candidate.content) ? candidate.content : [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const source = block as Record<string, unknown>;
    if (source.type !== 'tool_result') continue;

    const text = extractTextContent(source.content);
    if (!text) continue;

    try {
      const parsed = JSON.parse(text) as { type?: unknown; domain?: unknown; success?: unknown };
      if (parsed.domain !== 'workflow' || typeof parsed.type !== 'string' || typeof parsed.success !== 'boolean') {
        continue;
      }
    } catch {
      continue;
    }

    return {
      content: text,
      toolCallId: typeof source.tool_use_id === 'string' ? source.tool_use_id : undefined,
      toolName: typeof source.name === 'string' ? source.name : undefined,
    };
  }

  return null;
}

function toClaudeRuntimeResult(message: Record<string, unknown>): NonNullable<EngineHistoryResult['runtimeResult']> {
  const stopReason = message.stop_reason ?? message.stopReason;
  return {
    type: typeof message.type === 'string' ? message.type : undefined,
    subtype: typeof message.subtype === 'string' ? message.subtype : undefined,
    stopReason: typeof stopReason === 'string' ? stopReason : null,
    isError: typeof message.subtype === 'string' ? message.subtype.startsWith('error_') : false,
    durationMs: typeof message.duration_ms === 'number'
      ? message.duration_ms
      : typeof message.durationMs === 'number'
        ? message.durationMs
        : undefined,
  };
}

function isSkillReplayText(text: string): boolean {
  return text.includes('Base directory for this skill:')
    || text.includes('ARGUMENTS:')
    || text.includes('Base directory for this command:');
}

const HISTORY_BRIDGE_SYSTEM_MARKER = '[System: The user switched to a new model mid-conversation.';

function isHistoryBridgeUserText(text: string): boolean {
  return text.includes(HISTORY_BRIDGE_SYSTEM_MARKER);
}

function shouldHideClaudeUserMessage(
  entryRecord: Record<string, unknown>,
  messagePayload: unknown,
): boolean {
  if (entryRecord.isSynthetic === true) return true;
  if (entryRecord.shouldQuery === false) return true;
  if (typeof entryRecord.parent_tool_use_id === 'string' && entryRecord.parent_tool_use_id.length > 0) {
    return true;
  }

  const blocks = extractClaudeMessageBlocks(messagePayload);
  if (blocks.some((block) => block.type === 'tool_result')) {
    return true;
  }

  const combinedText = blocks
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');

  if (combinedText && (isSkillReplayText(combinedText) || isHistoryBridgeUserText(combinedText))) {
    return true;
  }

  if (typeof messagePayload === 'string' && (isSkillReplayText(messagePayload) || isHistoryBridgeUserText(messagePayload))) {
    return true;
  }

  return false;
}

type ClaudeDisplayMessage = {
  id: string;
  role: 'user' | 'assistant' | 'toolresult';
  content: unknown;
  timestamp?: number;
  isError: boolean;
  toolCallId?: string;
  toolName?: string;
};

async function loadPersistedClaudeMessagesForSdkSession(
  sdkSessionId: string,
  cwd: string,
): Promise<ClaudeDisplayMessage[]> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const configDir = await resolveClaudeSessionConfigDir(cwd, sdkSessionId) ?? getClaudeConfigDir();
  const sessionMessages = await withClaudeConfigDirEnv(configDir, async () => (
    sdk.getSessionMessages(sdkSessionId, { dir: cwd, includeSystemMessages: false })
  ));

  return sessionMessages
    .filter((entry) => {
      if (entry.type === 'assistant') return true;
      if (entry.type !== 'user') return false;
      const entryRecord = entry as Record<string, unknown>;
      return shouldKeepClaudeWorkflowToolResult(entry.message)
        || !shouldHideClaudeUserMessage(entryRecord, entry.message);
    })
    .map((entry) => {
      const entryRecord = entry as Record<string, unknown>;
      const workflowToolResult = entry.type === 'user' ? extractWorkflowToolResult(entry.message) : null;
      return {
        id: entry.uuid,
        role: workflowToolResult ? 'toolresult' as const : entry.type === 'assistant' ? 'assistant' as const : 'user' as const,
        content: workflowToolResult?.content ?? toRawContentFromClaudeMessage(entry.message),
        timestamp: toEpochMs(entryRecord.timestamp),
        isError: false,
        toolCallId: workflowToolResult?.toolCallId,
        toolName: workflowToolResult?.toolName,
      };
    });
}

function formatClaudeMessageForBridge(role: string, content: unknown): string {
  const text = typeof content === 'string' ? content : stringifyClaudeContent(content);
  if (!text.trim()) return '';
  const label = role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : 'Tool';
  return `${label}: ${text.trim()}`;
}

const HISTORY_BRIDGE_MAX_CHARS = 24_000;
const HISTORY_BRIDGE_MAX_MESSAGES = 40;

async function buildClaudeHistoryBridge(
  entry: EngineSessionRegistryEntry,
): Promise<string | null> {
  const cwd = entry.cwd;
  const archivedIds = entry.archivedClaudeSessionIds ?? [];
  if (!cwd || archivedIds.length === 0) return null;

  const persistedById = new Map<string, ClaudeDisplayMessage>();
  for (const sdkSessionId of archivedIds) {
    const batch = await loadPersistedClaudeMessagesForSdkSession(sdkSessionId, cwd);
    for (const message of batch) {
      if (message.id && !persistedById.has(message.id)) {
        persistedById.set(message.id, message);
      }
    }
  }

  const lines = [...persistedById.values()]
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
    .slice(-HISTORY_BRIDGE_MAX_MESSAGES)
    .map((message) => formatClaudeMessageForBridge(message.role, message.content))
    .filter(Boolean);

  if (lines.length === 0) return null;

  let body = lines.join('\n\n');
  if (body.length > HISTORY_BRIDGE_MAX_CHARS) {
    body = body.slice(body.length - HISTORY_BRIDGE_MAX_CHARS);
  }

  return [
    `${HISTORY_BRIDGE_SYSTEM_MARKER} Continue seamlessly with full awareness of the transcript below. Do not repeat or quote this transcript back to the user unless they ask.]`,
    '',
    body,
  ].join('\n');
}

/** Inject bridged history via system prompt only — never as a user message. */
async function consumePendingHistoryBridgeAppend(sessionKey: string): Promise<string | null> {
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  if (!entry?.pendingHistoryBridge) return null;

  const bridge = await buildClaudeHistoryBridge(entry);
  await upsertEngineSessionRegistryEntry({
    sessionKey,
    pendingHistoryBridge: false,
  });

  return bridge;
}

async function buildHistory(sessionKey: string, sessionId: string, cwd: string): Promise<EngineHistoryResult> {
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  const archivedIds = entry?.archivedClaudeSessionIds ?? [];
  const sessionIdsToLoad = [
    ...archivedIds,
    ...(sessionId ? [sessionId] : []),
  ];

  const persistedById = new Map<string, ClaudeDisplayMessage>();
  for (const sdkSessionId of sessionIdsToLoad) {
    const batch = await loadPersistedClaudeMessagesForSdkSession(sdkSessionId, cwd);
    for (const message of batch) {
      if (message.id && !persistedById.has(message.id)) {
        persistedById.set(message.id, message);
      }
    }
  }

  const persistedMessages = [...persistedById.values()]
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

  const cachedMessages = liveClaudeMessages.get(sessionKey) ?? [];
  const mergedMessages = [
    ...persistedMessages.map((message, index) => ({
      ...message,
      sortKey: index,
    })),
    ...cachedMessages
      .filter((message) => !persistedMessages.some((persisted) => persisted.id === message.id))
      .map((message, index) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        isError: message.isError,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        sortKey: persistedMessages.length + index + (message.receivedAt / 1_000_000_000_000),
      })),
  ]
    .sort((left, right) => left.sortKey - right.sortKey)
    .map(({ id, role, content, timestamp, isError, toolCallId, toolName }) => ({
      id,
      role,
      content,
      timestamp,
      isError,
      toolCallId,
      toolName,
    }));

  await upsertEngineSessionRegistryEntry({
    sessionKey,
    sessionId: sessionId || entry?.sessionId,
    cwd,
    agentId: extractAgentId(sessionKey),
    engineType: 'claude',
    updatedAt: Date.now(),
    model: entry?.model,
    accountId: entry?.accountId,
    archivedClaudeSessionIds: entry?.archivedClaudeSessionIds,
    pendingHistoryBridge: entry?.pendingHistoryBridge,
  });

  return {
    messages: mergedMessages,
    thinkingLevel: null,
    isRunning: activeClaudeQueries.has(sessionKey),
    runtimeResult: claudeRuntimeResults.get(sessionKey) ?? null,
  };
}

function shouldKeepClaudeWorkflowToolResult(messagePayload: unknown): boolean {
  return Boolean(extractWorkflowToolResult(messagePayload));
}

function extractAgentId(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

export async function consumeClaudeQuery(
  sessionKey: string,
  sessionId: string,
  cwd: string,
  query: AsyncIterable<Record<string, unknown>> & { close(): void },
  eventSink: ClaudeEventSink | null,
  runId: string,
  onMessage?: (message: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  let title: string | undefined;
  let seq = 0;
  let seenResult = false;
  let errorThrown = false;
  // Accumulated streaming text for the current assistant message. The SDK yields
  // content_block_delta/text_delta *fragments* (not a growing snapshot), and each
  // stream_event carries a per-event uuid (not a stable message id), so we must
  // rebuild the full text so far in a single variable. Each emitted delta carries
  // the accumulated text; the renderer replaces streamingMessage wholesale
  // (matching the OpenClaw Gateway's delta shape), producing token-by-token
  // appending output. Reset on message_start and when the complete assistant
  // message is emitted as 'final'.
  let streamText = '';

  const emitChat = (payload: Record<string, unknown>) => {
    if (!eventSink) return;
    eventSink.emit('chat:message', { message: { ...payload, runId, sessionKey, seq: seq++ } });
  };
  const emitAgentCompleted = () => {
    if (!eventSink) return;
    eventSink.emit('notification', { method: 'agent', params: { phase: 'completed', runId, sessionKey } });
  };

  try {
    // Mirror the OpenClaw Gateway's 'started' event so the renderer adopts the
    // runId/sending state immediately, before the first token arrives.
    emitChat({ state: 'started' });

    for await (const message of query) {
      const messageSessionId = typeof message.session_id === 'string' ? message.session_id : sessionId;

      // Partial streaming events (only yielded when includePartialMessages is on).
      // Forward text deltas as live 'delta' chat events for token-by-token rendering.
      // thinking_delta / input_json_delta are intentionally not streamed here; the
      // complete assistant message (emitted as 'final' below) carries them.
      if (message.type === 'stream_event') {
        const event = (message as { event?: Record<string, unknown> }).event;
        if (event) {
          if (event.type === 'message_start') {
            // A new assistant message begins — reset the accumulator.
            streamText = '';
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              streamText += delta.text;
              emitChat({
                state: 'delta',
                message: {
                  role: 'assistant',
                  id: runId,
                  content: [{ type: 'text', text: streamText }],
                },
              });
            }
          }
        }
        continue;
      }

      if (message.type === 'result') {
        claudeRuntimeResults.set(sessionKey, toClaudeRuntimeResult(message));
        seenResult = true;
        // Terminal signal: the renderer's isClaudeRunFragment guard keeps the run
        // active until this 'completed' notification fires
        // scheduleCompletedRunFinalization, which sets sending=false and
        // reconciles history.
        emitAgentCompleted();
      }
      if (!title && message.type === 'user' && 'message' in message && !shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
        title = stringifyClaudeContent((message as { message?: unknown }).message);
      }
      if ((message.type === 'user' || message.type === 'assistant') && 'message' in message) {
        if (message.type === 'user' && shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
          const workflowToolResult = extractWorkflowToolResult((message as { message?: unknown }).message);
          if (workflowToolResult) {
            const nextEntry = {
              id: typeof message.uuid === 'string' ? message.uuid : randomUUID(),
              role: 'toolresult' as const,
              content: workflowToolResult.content,
              timestamp: toEpochMs(message.timestamp) ?? Date.now(),
              toolCallId: workflowToolResult.toolCallId,
              toolName: workflowToolResult.toolName,
              receivedAt: Date.now(),
            };
            const current = liveClaudeMessages.get(sessionKey) ?? [];
            const existingIndex = current.findIndex((entry) => entry.id === nextEntry.id);
            if (existingIndex >= 0) {
              current[existingIndex] = nextEntry;
              liveClaudeMessages.set(sessionKey, [...current]);
            } else {
              liveClaudeMessages.set(sessionKey, [...current, nextEntry]);
            }
          }
          continue;
        }
        const liveMessage = message as {
          type: 'user' | 'assistant';
          uuid?: string;
          message?: unknown;
        };
        const nextEntry = {
          id: typeof liveMessage.uuid === 'string' ? liveMessage.uuid : randomUUID(),
          role: liveMessage.type,
          content: toRawContentFromClaudeMessage(liveMessage.message),
          timestamp: toEpochMs(message.timestamp) ?? Date.now(),
          receivedAt: Date.now(),
        };
        const current = liveClaudeMessages.get(sessionKey) ?? [];
        const existingIndex = current.findIndex((entry) => entry.id === nextEntry.id);
        if (existingIndex >= 0) {
          current[existingIndex] = nextEntry;
          liveClaudeMessages.set(sessionKey, [...current]);
        } else {
          liveClaudeMessages.set(sessionKey, [...current, nextEntry]);
        }

        // Emit a 'final' event for complete assistant messages so the renderer
        // commits them to messages[] and clears streamingMessage. For Claude the
        // isClaudeRunFragment guard keeps these non-terminal (sending stays true)
        // until the 'result' -> agent completed notification finalizes the run.
        if (liveMessage.type === 'assistant') {
          streamText = '';
          emitChat({
            state: 'final',
            message: {
              id: nextEntry.id,
              role: 'assistant',
              content: nextEntry.content,
              timestamp: nextEntry.timestamp,
            },
          });
        }
      }

      await upsertEngineSessionRegistryEntry({
        sessionKey,
        sessionId: messageSessionId,
        cwd,
        agentId: extractAgentId(sessionKey),
        engineType: 'claude',
        updatedAt: Date.now(),
        title,
        model: (await getEngineSessionRegistryEntry(sessionKey))?.model,
        accountId: (await getEngineSessionRegistryEntry(sessionKey))?.accountId,
      });
      // Allow callers (e.g. the scheduled-task worker) to capture per-message
      // data they need (run-record summary/runtimeResult) while reusing this
      // loop's event emission + liveClaudeMessages population. Not called for
      // stream_event messages, which `continue` above.
      await onMessage?.(message);
    }
  } catch (error) {
    errorThrown = true;
    emitChat({ state: 'error', errorMessage: String(error) });
    throw error;
  } finally {
    activeClaudeQueries.delete(sessionKey);
    // If the loop ended without a result and without an error, the query was
    // closed (e.g. user abort) — emit 'aborted' so the renderer finalizes.
    if (!seenResult && !errorThrown) {
      emitChat({ state: 'aborted' });
    }
  }
}

async function ensureClaudeRegistryEntry(sessionKey: string) {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  if (existing?.cwd) return existing;

  const agentId = extractAgentId(sessionKey);
  const cwd = await getAgentWorkspacePath(agentId);
  if (!cwd) return existing;
  const launchSelection = await resolveClaudeLaunchSelection(agentId, existing);

  const nextEntry = {
    sessionKey,
    sessionId: existing?.sessionId,
    cwd,
    agentId,
    engineType: 'claude' as const,
    updatedAt: existing?.updatedAt ?? Date.now(),
    title: existing?.title,
    model: launchSelection.model,
    accountId: launchSelection.accountId,
  };
  await upsertEngineSessionRegistryEntry(nextEntry);
  return nextEntry;
}

async function startClaudeQuery(
  sessionKey: string,
  prompt: string | AsyncIterable<SDKUserMessage>,
  options?: {
    additionalDirectories?: string[];
    eventSink?: ClaudeEventSink | null;
  },
): Promise<{ success: boolean; result?: { runId: string }; error?: string }> {
  try {
    await ensureClaudeConfigDir();
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const existing = await ensureClaudeRegistryEntry(sessionKey);
    const cwd = existing?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${sessionKey} is missing workspace cwd` };
    }

    const agentId = extractAgentId(sessionKey);
    const launchSelection = await resolveClaudeLaunchSelection(agentId, existing);
    const syncResult = await syncClaudeSkillsForAgent(agentId, cwd).catch((error) => {
      logger.warn('Failed to sync Claude skill bridge:', error);
      return null;
    });
    if (syncResult) {
      logger.info('Synced Claude skill bridge', {
        agentId,
        mirrored: syncResult.mirrored,
        skippedConflicts: syncResult.skippedConflicts,
      });
    }

    const sessionId = existing?.sessionId || randomUUID();
    const runId = randomUUID();
    const pathToClaudeCodeExecutable = getBundledClaudeExecutablePath();
    const runtimeOptions = await buildClaudeRuntimeOptions(sessionKey);
    const pluginPaths = await listClaudeBridgePluginPaths();
    claudeRuntimeResults.delete(sessionKey);
    await sanitizeClaudeSettingsEnv();
    const historyBridgeAppend = await consumePendingHistoryBridgeAppend(sessionKey);
    const systemPromptAppend = [runtimeOptions.systemPromptAppend, historyBridgeAppend]
      .filter(Boolean)
      .join('\n\n');
    const queryBaseOptions = {
      cwd,
      env: await buildClaudeEnvForAccount(launchSelection.accountId),
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      settingSources: ['user' as const],
      skills: 'all' as const,
      // Enable token-level streaming events (SDKPartialAssistantMessage) so the
      // consumer loop can forward text deltas to the renderer in real time.
      includePartialMessages: true,
      settings: launchSelection.model ? { model: launchSelection.model } : undefined,
      additionalDirectories: options?.additionalDirectories,
      pathToClaudeCodeExecutable,
      hooks: runtimeOptions.hooks,
      mcpServers: runtimeOptions.mcpServers,
      plugins: pluginPaths.map((pluginPath) => ({
        type: 'local' as const,
        path: pluginPath,
      })),
      systemPrompt: systemPromptAppend
        ? {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: systemPromptAppend,
        }
        : undefined,
    };
    const query = sdk.query({
      prompt,
      options: existing?.sessionId
        ? {
          ...queryBaseOptions,
          resume: existing.sessionId,
        }
        : {
          ...queryBaseOptions,
          sessionId,
        },
    });

    activeClaudeQueries.set(sessionKey, {
      close: () => query.close(),
      runId,
      sessionId,
      sessionKey,
    });

    await upsertEngineSessionRegistryEntry({
      sessionKey,
      sessionId,
      cwd,
      agentId: extractAgentId(sessionKey),
      engineType: 'claude',
      updatedAt: Date.now(),
      model: launchSelection.model,
      accountId: launchSelection.accountId,
    });

    void consumeClaudeQuery(sessionKey, sessionId, cwd, query as AsyncIterable<Record<string, unknown>> & { close(): void }, options?.eventSink ?? null, runId).catch((error) => {
      logger.error('Claude query failed:', error);
      cacheClaudeErrorMessage(sessionKey, error);
      void upsertEngineSessionRegistryEntry({
        sessionKey,
        sessionId,
        cwd,
        agentId: extractAgentId(sessionKey),
        engineType: 'claude',
        updatedAt: Date.now(),
        model: launchSelection.model,
        accountId: launchSelection.accountId,
      }).catch((registryError) => {
        logger.warn('Failed to persist Claude session metadata after query error:', registryError);
      });
    });
    return { success: true, result: { runId } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function deleteClaudeSessionByKey(sessionKey: string): Promise<void> {
  await ensureClaudeConfigDir();
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  liveClaudeMessages.delete(sessionKey);
  claudeRuntimeResults.delete(sessionKey);
  if (!entry?.sessionId) {
    await deleteEngineSessionRegistryEntry(sessionKey);
    return;
  }

  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const configDir = await resolveClaudeSessionConfigDir(entry.cwd!, entry.sessionId!) ?? getClaudeConfigDir();
  await withClaudeConfigDirEnv(configDir, async () => {
    await sdk.deleteSession(entry.sessionId!, { dir: entry.cwd! });
  });
  await deleteEngineSessionRegistryEntry(sessionKey);
}

export const claudeAdapter: EngineAdapter = {
  type: 'claude',

  async listSessions() {
    await ensureClaudeConfigDir();
    const entries = await listEngineSessionRegistryEntries('claude');
    const sessions: EngineSessionSummary[] = [];
    for (const entry of entries) {
      sessions.push({
        key: entry.sessionKey,
        label: entry.title,
        displayName: entry.title,
        updatedAt: entry.updatedAt,
        model: entry.model,
        engineType: 'claude',
      });
    }
    return { success: true, result: { sessions } };
  },

  async getHistory(_ctx, params) {
    const entry = await getEngineSessionRegistryEntry(params.sessionKey);
    if (!entry?.cwd) {
      return { success: true, result: { messages: [], thinkingLevel: null } };
    }
    if (!entry.sessionId && !(entry.archivedClaudeSessionIds?.length)) {
      return { success: true, result: { messages: [], thinkingLevel: null } };
    }

    try {
      const result = await buildHistory(
        params.sessionKey,
        entry.sessionId ?? '',
        entry.cwd,
      );
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessage(ctx: EngineAdapterContext, params) {
    return startClaudeQuery(params.sessionKey, params.message, { eventSink: ctx.gatewayManager });
  },

  async sendMessageWithMedia(ctx, params) {
    const entry = await ensureClaudeRegistryEntry(params.sessionKey);
    const cwd = entry?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${params.sessionKey} is missing workspace cwd` };
    }
    const additionalDirectories = getAdditionalDirectories(cwd, params.media ?? []);
    const prompt = await buildClaudeUserMessage(params.message, params.media ?? []);
    return startClaudeQuery(params.sessionKey, toClaudePromptStream(prompt), { additionalDirectories, eventSink: ctx.gatewayManager });
  },

  async abortRun(_ctx, params) {
    const active = activeClaudeQueries.get(params.sessionKey);
    if (!active) {
      return { success: true };
    }
    active.close();
    activeClaudeQueries.delete(params.sessionKey);
    return { success: true };
  },
};
