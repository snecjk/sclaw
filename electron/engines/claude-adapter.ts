import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { syncClaudeSkillsForAgent } from '../services/claude-skill-bridge';
import { logger } from '../utils/logger';
import { buildClaudeRuntimeOptions } from './claude-runtime-extensions';
import { toLegacyChatMessagePayload, type NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import { listClaudeBridgePluginPaths } from '../services/claude-plugin-bridge';
import { resolveSessionToolCwd } from '../services/session-catalog-service';
import { captureClaudeTurnTokenUsage } from '../services/turn-token-capture';
import { deleteEngineSessionRegistryEntry, getEngineSessionRegistryEntry, listEngineSessionRegistryEntries, patchEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry, type EngineSessionRegistryEntry } from './session-registry';
import type { EngineAdapter, EngineAdapterContext, EngineHistoryResult, EnginePermissionProfile, EngineSessionSummary } from './types';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam, MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import {
  createClaudeQuery,
  deleteClaudeSdkSession,
  ensureClaudeRuntimeReady,
  getClaudeSessionMessages,
  prepareClaudeRuntime,
  resolveClaudeLaunchSelection as resolveSharedClaudeLaunchSelection,
} from './claude-sdk-runtime';
import {
  appendArchivedClaudeSessionId,
  isMissingClaudeConversationError,
} from './claude-session-recovery';
import { mergeClaudeExecutionEntries, parseClaudeExecutionTurn, type ClaudeExecutionEntryBatch } from './claude-execution-snapshot';
import { inspectTranscript } from './chat-runtime-inspection';
import { logUserSend } from '../../shared/user-send-log';
import {
  applyClaudeStreamEvent,
  ClaudeStreamContentAccumulator,
  extractClaudeToolResultMessages,
} from './claude-stream-content';

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

const CLAUDE_TOOL_INPUT_DELTA_INTERVAL_MS = 400;
const CLAUDE_PARTIAL_TOOL_INPUT_PREVIEW_CHARS = 4_096;

const activeClaudeQueries = new Map<string, ActiveClaudeQuery>();
type ClaudeConsumeTiming = {
  launchStartedAt: number;
  queryCreatedAt: number;
  mode: 'new' | 'resume' | 'recovery';
};

function logClaudeQueryTiming(
  stage: string,
  input: {
    sessionKey: string;
    runId: string;
    launchStartedAt: number;
    stageStartedAt?: number;
    mode?: ClaudeConsumeTiming['mode'];
    details?: Record<string, unknown>;
  },
): void {
  const now = Date.now();
  logger.info('[claude-adapter][query-timing]', {
    stage,
    sessionKey: input.sessionKey,
    runId: input.runId,
    mode: input.mode,
    stageMs: input.stageStartedAt === undefined ? undefined : now - input.stageStartedAt,
    totalMs: now - input.launchStartedAt,
    ...input.details,
  });
}
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

/**
 * 执行器读 Claude run 终态（isError / summary / durationMs）。run 完成时
 * `consumeClaudeQuery` 已把 `result` 消息写入此 map；未运行 / 已清空 → null。
 */
export function getClaudeRuntimeResult(sessionKey: string): NonNullable<EngineHistoryResult['runtimeResult']> | null {
  return claudeRuntimeResults.get(sessionKey) ?? null;
}
const CLAUDE_VISION_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

async function resolveClaudeLaunchSelection(
  agentId: string,
  existing?: {
    model?: string;
    provider?: string;
    accountId?: string;
  } | null,
): Promise<{ model?: string; provider?: string; accountId?: string }> {
  const selection = await resolveSharedClaudeLaunchSelection({
    agentId,
    requestedModel: existing?.model,
    requestedAccountId: existing?.accountId,
  });
  return {
    model: selection.model,
    provider: selection.provider ?? existing?.provider,
    accountId: selection.accountId,
  };
}

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// Legacy SQLite activity repair (disabled 2026-08-27):
// SQLite session metadata has been the production source of truth long enough that
// history reads must no longer derive or mutate sidebar activity. Keeping this code
// commented preserves the old algorithm for a future explicit, low-priority Doctor
// repair command; it must not be restored to listSessions/getHistory hot paths.
// function resolveClaudeTranscriptActivityMs(
//   messages: Array<{ timestamp?: number }>,
// ): number {
//   let lastAt = 0;
//   for (const message of messages) {
//     const ts = typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
//       ? message.timestamp
//       : 0;
//     if (ts > lastAt) lastAt = ts;
//   }
//   return lastAt;
// }

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

// Legacy list-time transcript healing (disabled 2026-08-27):
// This used to scan every Claude transcript whenever sessions.list refreshed the
// sidebar. All SDK transcript reads share claudeConfigEnvQueue with interactive
// query creation, so a completed turn could enqueue enough reads to delay the next
// user turn by tens of seconds. SQLite already stores and sorts updatedAt; any future
// transcript reconciliation belongs in an explicit Doctor/background maintenance
// task and must never run from listSessions().
// async function resolveClaudeListedActivityMs(
//   entry: EngineSessionRegistryEntry,
// ): Promise<number | undefined> {
//   if (!entry.cwd) return entry.updatedAt;
//
//   const sessionIds = [
//     ...(entry.archivedClaudeSessionIds ?? []),
//     ...(entry.sessionId ? [entry.sessionId] : []),
//   ];
//   if (sessionIds.length === 0) return entry.updatedAt;
//
//   let lastAt = 0;
//   for (const sdkSessionId of sessionIds) {
//     try {
//       const batch = await loadPersistedClaudeMessagesForSdkSession(sdkSessionId, entry.cwd);
//       for (const message of batch) {
//         const ts = typeof message.timestamp === 'number' ? message.timestamp : 0;
//         if (ts > lastAt) lastAt = ts;
//       }
//     } catch {
//       // Ignore per-session transcript read failures.
//     }
//   }
//
//   for (const message of liveClaudeMessages.get(entry.sessionKey) ?? []) {
//     const ts = message.timestamp ?? 0;
//     if (ts > lastAt) lastAt = ts;
//   }
//
//   if (lastAt > 0) return lastAt;
//   return entry.updatedAt;
// }

async function loadPersistedClaudeMessagesForSdkSession(
  sdkSessionId: string,
  cwd: string,
): Promise<ClaudeDisplayMessage[]> {
  const sessionMessages = await getClaudeSessionMessages(sdkSessionId, cwd);

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
  await patchEngineSessionRegistryEntry(sessionKey, {
    pendingHistoryBridge: false,
  });

  return bridge;
}

async function buildHistory(sessionKey: string, sessionId: string, cwd: string): Promise<EngineHistoryResult> {
  const historyStartedAt = Date.now();
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  const archivedIds = entry?.archivedClaudeSessionIds ?? [];
  const sessionIdsToLoad = [
    ...archivedIds,
    ...(sessionId ? [sessionId] : []),
  ];

  const persistedById = new Map<string, ClaudeDisplayMessage>();
  for (const sdkSessionId of sessionIdsToLoad) {
    const transcriptReadStartedAt = Date.now();
    const batch = await loadPersistedClaudeMessagesForSdkSession(sdkSessionId, cwd);
    logger.info('[claude-adapter][transcript-timing]', {
      stage: 'sdk_session_messages_read',
      sessionKey,
      isCurrentSession: sdkSessionId === sessionId,
      messageCount: batch.length,
      stageMs: Date.now() - transcriptReadStartedAt,
      totalMs: Date.now() - historyStartedAt,
    });
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

  // Legacy read-time metadata repair (disabled 2026-08-27):
  // getHistory is now side-effect free. Activity is written when a real user/SDK
  // message is processed, and SQLite is the sidebar ordering source of truth.
  // Re-enabling this block would make a read mutate activity and could reintroduce
  // transcript/interactive-query queue contention. Preserve it only as reference
  // for a future explicit Doctor repair command.
  // const transcriptActivityAt = resolveClaudeTranscriptActivityMs(mergedMessages);
  // await upsertEngineSessionRegistryEntry({
  //   sessionKey,
  //   sessionId: sessionId || entry?.sessionId,
  //   cwd,
  //   agentId: extractAgentId(sessionKey),
  //   engineType: 'claude',
  //   ...(transcriptActivityAt > 0 ? { updatedAt: transcriptActivityAt } : {}),
  //   model: entry?.model,
  //   provider: entry?.provider,
  //   accountId: entry?.accountId,
  //   archivedClaudeSessionIds: entry?.archivedClaudeSessionIds,
  //   pendingHistoryBridge: entry?.pendingHistoryBridge,
  // });

  logger.info('[claude-adapter][transcript-timing]', {
    stage: 'history_built',
    sessionKey,
    persistedMessageCount: persistedMessages.length,
    cachedMessageCount: cachedMessages.length,
    mergedMessageCount: mergedMessages.length,
    isQueryActive: activeClaudeQueries.has(sessionKey),
    totalMs: Date.now() - historyStartedAt,
  });

  return {
    messages: mergedMessages,
    thinkingLevel: null,
    isRunning: activeClaudeQueries.has(sessionKey),
    runtimeResult: claudeRuntimeResults.get(sessionKey) ?? null,
  };
}

async function buildClaudeExecutionSnapshot(
  entry: EngineSessionRegistryEntry,
  limit: number,
) {
  const sessionIds = [
    ...(entry.archivedClaudeSessionIds ?? []),
    ...(entry.sessionId ? [entry.sessionId] : []),
  ];
  const batches: ClaudeExecutionEntryBatch[] = [];

  for (const sessionId of sessionIds) {
    const batch = await getClaudeSessionMessages(sessionId, entry.cwd ?? '');
    batches.push({
      sessionId,
      entries: batch as unknown as Record<string, unknown>[],
    });
  }

  const entries = mergeClaudeExecutionEntries(batches, limit);
  return parseClaudeExecutionTurn(entries);
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
  recoveryOptions?: {
    suppressMissingConversationFailure?: boolean;
    suppressStartedEvent?: boolean;
    initialSeq?: number;
    timing?: ClaudeConsumeTiming;
  },
): Promise<void> {
  const iterationStartedAt = Date.now();
  const timing = recoveryOptions?.timing ?? {
    launchStartedAt: iterationStartedAt,
    queryCreatedAt: iterationStartedAt,
    mode: 'new' as const,
  };
  let title: string | undefined;
  let seq = recoveryOptions?.initialSeq ?? 0;
  let seenResult = false;
  let completionEmitted = false;
  let completionDeferred = false;
  let errorThrown = false;
  // Claude can finish the current main-agent turn while background subagents
  // are still running. Their task notifications can then trigger another main
  // turn on the same query. A `result` therefore is terminal for the app run
  // only when no SDK task remains outstanding.
  const pendingTaskIds = new Set<string>();
  const ignoredAmbientTaskIds = new Set<string>();
  // Accumulated streaming text for the current assistant message. The SDK yields
  // content_block_delta/text_delta *fragments* (not a growing snapshot), and each
  // stream_event carries a per-event uuid (not a stable message id), so we must
  // rebuild the full text so far in a single variable. Each emitted delta carries
  // the accumulated text; the renderer replaces streamingMessage wholesale
  // (matching the OpenClaw Gateway's delta shape), producing token-by-token
  // appending output. Reset on message_start and when the complete assistant
  // message is emitted as 'final'.
  let streamThinking = '';
  const streamContent = new ClaudeStreamContentAccumulator();
  const toolNamesById = new Map<string, string>();
  let pendingToolInputDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingToolInputDelta = false;
  let lastToolInputDeltaAt = 0;
  let firstSdkMessageSeen = false;

  const emitEngineEvent = (event: NormalizedEngineEvent) => {
    if (!eventSink) return;
    eventSink.emit('chat:message', toLegacyChatMessagePayload({ ...event, runId, sessionKey, seq: seq++ }));
  };
  const emitAgentCompleted = () => {
    if (completionEmitted) return;
    completionEmitted = true;
    if (!eventSink) return;
    eventSink.emit('notification', { method: 'agent', params: { phase: 'completed', runId, sessionKey } });
  };
  const emitStreamingDelta = (options?: { partialToolInput?: boolean }) => {
    const content: Array<Record<string, unknown>> = [];
    if (streamThinking) {
      content.push({ type: 'thinking', thinking: streamThinking });
    }
    content.push(...streamContent.buildContentArray(
      options?.partialToolInput
        ? { maxPartialInputChars: CLAUDE_PARTIAL_TOOL_INPUT_PREVIEW_CHARS }
        : undefined,
    ));
    if (content.length === 0) return;
    emitEngineEvent({
      type: 'message.delta',
      message: {
        role: 'assistant',
        id: runId,
        content,
      },
    });
  };
  const clearPendingToolInputDelta = () => {
    if (pendingToolInputDeltaTimer) {
      clearTimeout(pendingToolInputDeltaTimer);
      pendingToolInputDeltaTimer = null;
    }
    pendingToolInputDelta = false;
  };
  const flushPendingToolInputDelta = () => {
    if (!pendingToolInputDelta) return;
    clearPendingToolInputDelta();
    lastToolInputDeltaAt = Date.now();
    emitStreamingDelta({ partialToolInput: true });
  };
  const queueToolInputDelta = () => {
    pendingToolInputDelta = true;
    const elapsed = Date.now() - lastToolInputDeltaAt;
    if (elapsed >= CLAUDE_TOOL_INPUT_DELTA_INTERVAL_MS) {
      flushPendingToolInputDelta();
      return;
    }
    if (pendingToolInputDeltaTimer) return;
    pendingToolInputDeltaTimer = setTimeout(() => {
      pendingToolInputDeltaTimer = null;
      flushPendingToolInputDelta();
    }, CLAUDE_TOOL_INPUT_DELTA_INTERVAL_MS - elapsed);
  };

  try {
    logClaudeQueryTiming('iterator_started', {
      sessionKey,
      runId,
      launchStartedAt: timing.launchStartedAt,
      stageStartedAt: timing.queryCreatedAt,
      mode: timing.mode,
    });
    // Mirror the OpenClaw Gateway's 'started' event so the renderer adopts the
    // runId/sending state immediately, before the first token arrives.
    if (!recoveryOptions?.suppressStartedEvent) {
      emitEngineEvent({ type: 'turn.started' });
    }

    for await (const message of query) {
      if (!firstSdkMessageSeen) {
        firstSdkMessageSeen = true;
        logClaudeQueryTiming('first_sdk_message', {
          sessionKey,
          runId,
          launchStartedAt: timing.launchStartedAt,
          stageStartedAt: iterationStartedAt,
          mode: timing.mode,
          details: {
            messageType: typeof message.type === 'string' ? message.type : 'unknown',
            messageSubtype: typeof message.subtype === 'string' ? message.subtype : undefined,
          },
        });
      }
      const messageSessionId = typeof message.session_id === 'string' ? message.session_id : sessionId;

      if (message.type === 'system') {
        const taskMessage = message as {
          subtype?: string;
          task_id?: string;
          skip_transcript?: boolean;
          patch?: { status?: string };
        };
        const taskId = typeof taskMessage.task_id === 'string' ? taskMessage.task_id : '';
        if (taskId && taskMessage.subtype === 'task_started') {
          if (taskMessage.skip_transcript) {
            ignoredAmbientTaskIds.add(taskId);
          } else {
            pendingTaskIds.add(taskId);
          }
        } else if (taskId && taskMessage.subtype === 'task_updated') {
          if (!ignoredAmbientTaskIds.has(taskId)) {
            const status = taskMessage.patch?.status;
            if (status === 'completed' || status === 'failed' || status === 'killed') {
              pendingTaskIds.delete(taskId);
            } else if (status === 'pending' || status === 'running' || status === 'paused') {
              pendingTaskIds.add(taskId);
            }
          }
        } else if (taskId && taskMessage.subtype === 'task_notification') {
          pendingTaskIds.delete(taskId);
          ignoredAmbientTaskIds.delete(taskId);
        }
      }

      // Partial streaming events (only yielded when includePartialMessages is on).
      // Forward text + thinking deltas as live 'delta' chat events (钉钉 progress/content).
      if (message.type === 'stream_event') {
        const event = (message as { event?: Record<string, unknown> }).event;
        if (event) {
          if (event.type === 'message_start') {
            // A new assistant message begins — reset the accumulator.
            clearPendingToolInputDelta();
            streamThinking = '';
            applyClaudeStreamEvent(streamContent, event);
          } else if (event.type === 'content_block_start') {
            flushPendingToolInputDelta();
            const block = event.content_block as { type?: string; id?: string; name?: string } | undefined;
            applyClaudeStreamEvent(streamContent, event);
            if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
              if (typeof block.id === 'string' && block.id) {
                toolNamesById.set(block.id, block.name);
              }
              emitStreamingDelta();
              eventSink?.emit('notification', {
                method: 'agent',
                params: {
                  phase: 'tool_start',
                  runId,
                  sessionKey,
                  name: block.name,
                  data: { name: block.name },
                },
              });
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta as {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            } | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              flushPendingToolInputDelta();
              applyClaudeStreamEvent(streamContent, event);
              emitStreamingDelta();
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              flushPendingToolInputDelta();
              streamThinking += delta.thinking;
              emitStreamingDelta();
            } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              applyClaudeStreamEvent(streamContent, event);
              queueToolInputDelta();
            }
          } else if (event.type === 'content_block_stop' || event.type === 'message_stop') {
            flushPendingToolInputDelta();
          }
        }
        continue;
      }

      if (message.type === 'result') {
        if (!seenResult) {
          logClaudeQueryTiming('first_result_message', {
            sessionKey,
            runId,
            launchStartedAt: timing.launchStartedAt,
            stageStartedAt: iterationStartedAt,
            mode: timing.mode,
          });
        }
        captureClaudeTurnTokenUsage({
          sessionKey,
          resultMessage: message,
          model: typeof (message as { model?: unknown }).model === 'string'
            ? (message as { model: string }).model
            : undefined,
        });
        flushPendingToolInputDelta();
        clearPendingToolInputDelta();
        claudeRuntimeResults.set(sessionKey, toClaudeRuntimeResult(message));
        seenResult = true;
        // A main-agent result may merely mean "waiting for background tasks".
        // Keep the same app run alive so task_notification/auto-continuation
        // messages remain visible. A later result after all tasks settle is the
        // actual terminal signal.
        if (pendingTaskIds.size === 0) {
          if (completionDeferred) {
            logger.debug('[claude-adapter] completing resumed run after background tasks settled', {
              sessionKey,
              runId,
            });
          }
          emitAgentCompleted();
        } else {
          completionDeferred = true;
          logger.debug('[claude-adapter] deferring run completion for background tasks', {
            sessionKey,
            runId,
            pendingTaskIds: [...pendingTaskIds],
          });
        }
      }
      if (!title && message.type === 'user' && 'message' in message && !shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
        title = stringifyClaudeContent((message as { message?: unknown }).message);
      }
      if ((message.type === 'user' || message.type === 'assistant') && 'message' in message) {
        if (message.type === 'user' && shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
          // Hidden user messages carry tool_result blocks. The `continue` below
          // skips the tail onMessage path, so surface the message to observers
          // first (UI / history / workflow tool_result indexing).
          await onMessage?.(message);
          for (const toolResult of extractClaudeToolResultMessages(
            (message as { message?: unknown }).message,
            toolNamesById,
          )) {
            emitEngineEvent({ type: 'tool.result', message: toolResult });
          }
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
          clearPendingToolInputDelta();
          streamContent.reset();
          streamThinking = '';
          emitEngineEvent({
            type: 'message.final',
            message: {
              id: nextEntry.id,
              role: 'assistant',
              content: nextEntry.content,
              timestamp: nextEntry.timestamp,
            },
          });
        }
      }

      const currentRegistryEntry = await getEngineSessionRegistryEntry(sessionKey);
      await upsertEngineSessionRegistryEntry({
        sessionKey,
        sessionId: messageSessionId,
        cwd,
        agentId: extractAgentId(sessionKey),
        engineType: 'claude',
        updatedAt: toEpochMs(message.timestamp) ?? Date.now(),
        title,
        model: currentRegistryEntry?.model,
        provider: currentRegistryEntry?.provider,
        accountId: currentRegistryEntry?.accountId,
        archivedClaudeSessionIds: currentRegistryEntry?.archivedClaudeSessionIds,
        pendingHistoryBridge: currentRegistryEntry?.pendingHistoryBridge,
      });
      // Allow callers (e.g. the scheduled-task worker) to capture per-message
      // data they need (run-record summary/runtimeResult) while reusing this
      // loop's event emission + liveClaudeMessages population. Not called for
      // stream_event messages, which `continue` above.
      await onMessage?.(message);
    }
    logClaudeQueryTiming('iterator_eof', {
      sessionKey,
      runId,
      launchStartedAt: timing.launchStartedAt,
      stageStartedAt: iterationStartedAt,
      mode: timing.mode,
      details: { seenResult, completionEmitted, pendingTaskCount: pendingTaskIds.size },
    });
  } catch (error) {
    errorThrown = true;
    if (!(
      recoveryOptions?.suppressMissingConversationFailure
      && isMissingClaudeConversationError(error)
    )) {
      emitEngineEvent({ type: 'turn.failed', errorMessage: String(error) });
    }
    throw error;
  } finally {
    flushPendingToolInputDelta();
    clearPendingToolInputDelta();
    activeClaudeQueries.delete(sessionKey);
    logClaudeQueryTiming('active_query_removed', {
      sessionKey,
      runId,
      launchStartedAt: timing.launchStartedAt,
      stageStartedAt: iterationStartedAt,
      mode: timing.mode,
      details: { seenResult, completionEmitted, errorThrown },
    });
    // Some SDK task modes settle the outstanding task and then close the
    // iterator without producing another result. At iterator EOF all observed
    // tasks are terminal, so finalize the already-seen result here.
    if (seenResult && !completionEmitted && pendingTaskIds.size === 0) {
      emitAgentCompleted();
    }
    // If the loop ended without a result and without an error, the query was
    // closed (e.g. user abort) — emit 'aborted' so the renderer finalizes.
    if (!seenResult && !errorThrown) {
      emitEngineEvent({ type: 'turn.aborted' });
    }
  }
}

async function ensureClaudeRegistryEntry(
  sessionKey: string,
): Promise<EngineSessionRegistryEntry | null> {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  const agentId = extractAgentId(sessionKey);
  const cwd = await resolveSessionToolCwd(sessionKey, agentId);
  if (!cwd) return existing;
  if (existing?.cwd === cwd) return existing;

  const launchSelection = await resolveClaudeLaunchSelection(agentId, existing);

  const nextEntry: EngineSessionRegistryEntry = {
    sessionKey,
    sessionId: existing?.sessionId,
    cwd,
    agentId,
    engineType: 'claude' as const,
    updatedAt: Date.now(),
    title: existing?.title,
    model: launchSelection.model,
    provider: launchSelection.provider,
    accountId: launchSelection.accountId,
    archivedClaudeSessionIds: existing?.archivedClaudeSessionIds,
    pendingHistoryBridge: existing?.pendingHistoryBridge,
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
    /** 本轮用户原文，用于口头钉钉发送等按需注入。 */
    userPrompt?: string;
    systemPromptAppend?: string;
    /** 定时任务执行时由 executor 透传；交互式 chat 不设（→ 保留默认 bypass）。 */
    permissionProfile?: EnginePermissionProfile;
  },
): Promise<{ success: boolean; result?: { runId: string }; error?: string }> {
  const launchStartedAt = Date.now();
  try {
    const existing = await ensureClaudeRegistryEntry(sessionKey);
    logger.info('[claude-adapter] ensureClaudeRegistryEntry', existing);
    const cwd = existing?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${sessionKey} is missing workspace cwd` };
    }

    const agentId = extractAgentId(sessionKey);
    const sharedRuntime = await prepareClaudeRuntime({
      agentId,
      requestedAccountId: existing?.accountId,
      requestedModel: existing?.model,
    });
    const launchSelection = {
      accountId: sharedRuntime.selection.accountId,
      model: sharedRuntime.selection.model,
      provider: sharedRuntime.selection.provider ?? existing?.provider,
    };
    await syncClaudeSkillsForAgent(agentId, cwd).catch((error) => {
      logger.warn('Failed to sync Claude skill bridge:', error);
      return null;
    });

    const sessionId = existing?.sessionId || randomUUID();
    const runId = randomUUID();
    const queryMode = existing?.sessionId ? 'resume' as const : 'new' as const;
    logClaudeQueryTiming('launch_prepared', {
      sessionKey,
      runId,
      launchStartedAt,
      mode: queryMode,
      details: { hasExistingSession: Boolean(existing?.sessionId) },
    });
    const runtimeOptions = await buildClaudeRuntimeOptions(sessionKey, options?.userPrompt);
    const pluginPaths = await listClaudeBridgePluginPaths();
    claudeRuntimeResults.delete(sessionKey);
    const historyBridgeAppend = await consumePendingHistoryBridgeAppend(sessionKey);
    // 默认将 cwd 工作区/工作空间写入提示词：用户未指定特殊路径时，模型以该路径作为默认工作目录。
    // 走 systemPromptAppend（与 historyBridge 一致），避免污染用户消息与侧栏标题。
    const cwdPromptNote = `# 工作区/项目空间限制\n 当前工作目录/空间根目录为：**${cwd}**。若用户未指定特殊路径，请默认使用该路径作为工作目录进行文件读写等操作。**如果记忆中也出现了，必须以此处路径为准**。`;
    const systemPromptAppend = [cwdPromptNote, runtimeOptions.systemPromptAppend, options?.systemPromptAppend, historyBridgeAppend]
      .filter(Boolean)
      .join('\n\n');
    logger.info(`[claude-adapter][prompt] final systemPromptAppend: sessionKey=${sessionKey}, systemPromptAppend=\n${systemPromptAppend || '(none)'}`);
    const userPromptPreview =
      typeof prompt === 'string'
        ? prompt
        : '(stream/non-string prompt)';
    logger.info('[claude-adapter][prompt] user message', {
      sessionKey,
      userPromptChars: typeof prompt === 'string' ? prompt.length : null,
      userPrompt: userPromptPreview,
    });
    const userMessageForLog = typeof prompt === 'string'
      ? prompt
      : (options?.userPrompt ?? '(stream/non-string prompt)');
    logUserSend({
      engine: 'claude',
      sessionKey,
      message: userMessageForLog,
      messageLength: userMessageForLog.length,
      systemPromptAppend: systemPromptAppend || null,
      systemPromptAppendLength: systemPromptAppend.length,
    });
    // 权限档位：定时任务带 permissionProfile 时按档映射（dangerous-bypass→bypass；
    // 其余→默认受约束）；交互式 chat（undefined）保留既有 bypass 默认，不改变行为。
    const permissionProfile = options?.permissionProfile;
    const permissionMode: 'bypassPermissions' | undefined =
      permissionProfile === undefined
        ? 'bypassPermissions'
        : permissionProfile === 'dangerous-bypass'
          ? 'bypassPermissions'
          : undefined;
    const allowDangerouslySkipPermissions = permissionMode === 'bypassPermissions';
    const queryBaseOptions = {
      cwd,
      env: sharedRuntime.env,
      permissionMode,
      allowDangerouslySkipPermissions,
      settingSources: ['user' as const],
      skills: 'all' as const,
      // Enable token-level streaming events (SDKPartialAssistantMessage) so the
      // consumer loop can forward text deltas to the renderer in real time.
      includePartialMessages: true,
      settings: launchSelection.model ? { model: launchSelection.model } : undefined,
      additionalDirectories: options?.additionalDirectories,
      pathToClaudeCodeExecutable: sharedRuntime.pathToClaudeCodeExecutable,
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
    const queryCreateStartedAt = Date.now();
    logClaudeQueryTiming('query_create_started', {
      sessionKey,
      runId,
      launchStartedAt,
      mode: queryMode,
    });
    const query = await createClaudeQuery({
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
    }, { sessionKey, runId, mode: queryMode });
    const queryCreatedAt = Date.now();
    logClaudeQueryTiming('query_created', {
      sessionKey,
      runId,
      launchStartedAt,
      stageStartedAt: queryCreateStartedAt,
      mode: queryMode,
    });

    activeClaudeQueries.set(sessionKey, {
      close: () => query.close(),
      runId,
      sessionId,
      sessionKey,
    });
    logClaudeQueryTiming('active_query_registered', {
      sessionKey,
      runId,
      launchStartedAt,
      stageStartedAt: queryCreatedAt,
      mode: queryMode,
    });

    const registryUpsertStartedAt = Date.now();
    await upsertEngineSessionRegistryEntry({
      sessionKey,
      sessionId,
      cwd,
      agentId: extractAgentId(sessionKey),
      engineType: 'claude',
      updatedAt: Date.now(),
      model: launchSelection.model,
      provider: launchSelection.provider,
      accountId: launchSelection.accountId,
      archivedClaudeSessionIds: existing?.archivedClaudeSessionIds,
      pendingHistoryBridge: existing?.pendingHistoryBridge,
    });
    logClaudeQueryTiming('session_registry_upserted', {
      sessionKey,
      runId,
      launchStartedAt,
      stageStartedAt: registryUpsertStartedAt,
      mode: queryMode,
    });

    const consumeWithMissingSessionRecovery = async (): Promise<void> => {
      try {
        await consumeClaudeQuery(
          sessionKey,
          sessionId,
          cwd,
          query as AsyncIterable<Record<string, unknown>> & { close(): void },
          options?.eventSink ?? null,
          runId,
          undefined,
          {
            suppressMissingConversationFailure: Boolean(existing?.sessionId) && typeof prompt === 'string',
            timing: { launchStartedAt, queryCreatedAt, mode: queryMode },
          },
        );
      } catch (error) {
        const invalidSessionId = existing?.sessionId;
        if (
          invalidSessionId
          && typeof prompt === 'string'
          && isMissingClaudeConversationError(error)
        ) {
          logger.warn('[claude-adapter] Resume session is unavailable; retrying as a new SDK session', {
            sessionKey,
            invalidSessionId,
          });
          const archivedClaudeSessionIds = appendArchivedClaudeSessionId(
            existing.archivedClaudeSessionIds,
            invalidSessionId,
          );
          const recoveryEntry: EngineSessionRegistryEntry = {
            ...existing,
            sessionKey,
            sessionId: undefined,
            cwd,
            agentId: extractAgentId(sessionKey),
            engineType: 'claude',
            model: launchSelection.model,
            provider: launchSelection.provider,
            accountId: launchSelection.accountId,
            archivedClaudeSessionIds,
            pendingHistoryBridge: true,
          };
          const recoveryBridge = await buildClaudeHistoryBridge(recoveryEntry);
          const recoverySystemPromptAppend = [systemPromptAppend, recoveryBridge]
            .filter(Boolean)
            .join('\n\n');
          const recoverySessionId = randomUUID();
          const recoveryQueryCreateStartedAt = Date.now();
          const recoveryQuery = await createClaudeQuery({
            prompt,
            options: {
              ...queryBaseOptions,
              sessionId: recoverySessionId,
              systemPrompt: recoverySystemPromptAppend
                ? {
                  type: 'preset' as const,
                  preset: 'claude_code' as const,
                  append: recoverySystemPromptAppend,
                }
                : undefined,
            },
          }, { sessionKey, runId, mode: 'recovery' });
          const recoveryQueryCreatedAt = Date.now();
          logClaudeQueryTiming('recovery_query_created', {
            sessionKey,
            runId,
            launchStartedAt,
            stageStartedAt: recoveryQueryCreateStartedAt,
            mode: 'recovery',
          });
          activeClaudeQueries.set(sessionKey, {
            close: () => recoveryQuery.close(),
            runId,
            sessionId: recoverySessionId,
            sessionKey,
          });
          await upsertEngineSessionRegistryEntry({
            ...recoveryEntry,
            sessionId: recoverySessionId,
            updatedAt: Date.now(),
            pendingHistoryBridge: false,
          });
          await consumeClaudeQuery(
            sessionKey,
            recoverySessionId,
            cwd,
            recoveryQuery as AsyncIterable<Record<string, unknown>> & { close(): void },
            options?.eventSink ?? null,
            runId,
            undefined,
            {
              suppressStartedEvent: true,
              initialSeq: 1,
              timing: {
                launchStartedAt,
                queryCreatedAt: recoveryQueryCreatedAt,
                mode: 'recovery',
              },
            },
          );
          return;
        }
        throw error;
      }
    };

    logClaudeQueryTiming('consumer_scheduled', {
      sessionKey,
      runId,
      launchStartedAt,
      stageStartedAt: queryCreatedAt,
      mode: queryMode,
    });
    void consumeWithMissingSessionRecovery().catch((error) => {
      logger.error('Claude query failed:', error);
      cacheClaudeErrorMessage(sessionKey, error);
      void patchEngineSessionRegistryEntry(sessionKey, {
        updatedAt: Date.now(),
        model: launchSelection.model,
        provider: launchSelection.provider,
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

function isClaudeSessionAlreadyGoneError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes('not found in project directory')
    || message.includes('not found in any project directory')
    || message.includes('not found (no projects directory)')
    || /\bENOENT\b/.test(message)
    || /\bENOTDIR\b/.test(message)
  );
}

export async function deleteClaudeSessionByKey(sessionKey: string): Promise<void> {
  await ensureClaudeRuntimeReady();
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  liveClaudeMessages.delete(sessionKey);
  claudeRuntimeResults.delete(sessionKey);
  if (!entry?.sessionId) {
    await deleteEngineSessionRegistryEntry(sessionKey);
    return;
  }

  const cwd = typeof entry.cwd === 'string' ? entry.cwd.trim() : '';
  if (cwd) {
    try {
      await deleteClaudeSdkSession(entry.sessionId, cwd);
    } catch (error) {
      // Workspace may have been deleted on disk (dirty catalog rows). Still purge our registry.
      if (!isClaudeSessionAlreadyGoneError(error)) throw error;
      logger.warn(`[claude] deleteSession skipped for missing session/workspace ${sessionKey}:`, error);
    }
  } else {
    logger.warn(`[claude] deleteSession skipped: missing cwd for ${sessionKey}`);
  }
  await deleteEngineSessionRegistryEntry(sessionKey);
}

export const claudeAdapter: EngineAdapter = {
  type: 'claude',
  chatCapabilities: {
    hasReliableRuntimeStatus: true,
    hasStructuredReasoningEvents: true,
    hasStructuredToolEvents: true,
    requiresHistoryProjection: false,
  },

  classifyFinalMessage({ message, phase }) {
    if (phase === 'completed') return 'completed';
    return message == null ? 'awaiting_transcript' : 'progress';
  },

  async inspectRun(_ctx, params) {
    const inspectionStartedAt = Date.now();
    const active = activeClaudeQueries.get(params.sessionKey);
    if (active) {
      logger.info('[claude-adapter][transcript-timing]', {
        stage: 'inspect_skipped_active_query',
        sessionKey: params.sessionKey,
        runId: active.runId,
        stageMs: Date.now() - inspectionStartedAt,
      });
      return { status: 'active', runId: active.runId };
    }
    const entry = await getEngineSessionRegistryEntry(params.sessionKey);
    if (!entry?.cwd || (!entry.sessionId && !(entry.archivedClaudeSessionIds?.length))) {
      return { status: 'not_started', runId: params.runId ?? undefined };
    }
    try {
      const history = await buildHistory(params.sessionKey, entry.sessionId ?? '', entry.cwd);
      const inspection = inspectTranscript({
        messages: history.messages,
        startedAt: params.startedAt,
        isRunning: history.isRunning,
        runId: params.runId,
      });
      logger.info('[claude-adapter][transcript-timing]', {
        stage: 'inspect_completed',
        sessionKey: params.sessionKey,
        runId: params.runId ?? undefined,
        status: inspection.status,
        messageCount: history.messages.length,
        hasTranscriptRevision: Boolean(inspection.transcriptRevision),
        stageMs: Date.now() - inspectionStartedAt,
      });
      return inspection;
    } catch (error) {
      return { status: 'unknown', runId: params.runId ?? undefined, reason: String(error) };
    }
  },

  prepareMemoryInjection(params, memory) {
    const memorySystemPrompt = [memory.preference, memory.execution].filter(Boolean).join('\n\n');
    // Memory is advisory. Put task-specific system context after it so recalled
    // experience cannot override the current task's rules or workflow contract.
    const systemPromptAppend = [memorySystemPrompt, params.systemPromptAppend?.trim()]
      .filter(Boolean)
      .join('\n\n') || undefined;
    if (memorySystemPrompt) {
      logger.info(`[agent-memory][claude] systemPromptAppend after memory injection:\n${systemPromptAppend}`);
    }
    return { ...params, systemPromptAppend };
  },

  async listSessions() {
    // Legacy runtime preparation (disabled 2026-08-27): sessions.list is a pure
    // SQLite metadata query and must not initialize or sanitize Claude SDK state.
    // await ensureClaudeRuntimeReady();
    const entries = await listEngineSessionRegistryEntries('claude');
    // SQLite session_engine_bindings is already ordered by updated_at DESC and
    // catalog_sessions mirrors that activity. A list operation must remain a
    // metadata-only DB read; never scan SDK transcripts here because those reads
    // share the same global config environment queue as interactive Claude queries.
    const sessions: EngineSessionSummary[] = entries.map((entry) => ({
      key: entry.sessionKey,
      label: entry.title,
      displayName: entry.title,
      updatedAt: entry.updatedAt,
      model: entry.model,
      engineType: 'claude' as const,
    }));
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

  async getExecutionSnapshot(_ctx, params) {
    const entry = await getEngineSessionRegistryEntry(params.sessionKey);
    if (!entry?.cwd || (!entry.sessionId && !(entry.archivedClaudeSessionIds?.length))) {
      return { success: true, result: null };
    }

    try {
      return {
        success: true,
        result: await buildClaudeExecutionSnapshot(entry, params.limit),
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessage(ctx: EngineAdapterContext, params) {
    return startClaudeQuery(params.sessionKey, params.message, {
      eventSink: ctx.eventSink
        ? { emit: (event, payload) => Boolean(ctx.eventSink?.emit(event, payload)) }
        : ctx.gatewayManager ?? null,
      userPrompt: params.message,
      systemPromptAppend: params.systemPromptAppend,
      permissionProfile: params.permissionProfile,
    });
  },

  async sendMessageWithMedia(ctx, params) {
    const entry = await ensureClaudeRegistryEntry(params.sessionKey);
    const cwd = entry?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${params.sessionKey} is missing workspace cwd` };
    }
    const additionalDirectories = getAdditionalDirectories(cwd, params.media ?? []);
    const prompt = await buildClaudeUserMessage(params.message, params.media ?? []);
    return startClaudeQuery(params.sessionKey, toClaudePromptStream(prompt), {
      additionalDirectories,
      eventSink: ctx.eventSink
        ? { emit: (event, payload) => Boolean(ctx.eventSink?.emit(event, payload)) }
        : ctx.gatewayManager ?? null,
      userPrompt: params.message,
      systemPromptAppend: params.systemPromptAppend,
      permissionProfile: params.permissionProfile,
    });
  },

  async abortRun(_ctx, params) {
    const active = activeClaudeQueries.get(params.sessionKey);
    if (!active) {
      return { success: true, result: { aborted: false, runIds: [] } };
    }
    active.close();
    activeClaudeQueries.delete(params.sessionKey);
    return { success: true, result: { aborted: true, runIds: [params.runId ?? params.sessionKey] } };
  },
};
