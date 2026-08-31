import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import type {
  EngineAdapter,
  EngineAdapterContext,
  EngineSendParams,
  EngineSendWithMediaParams,
  EngineSessionSummary,
} from './types';
import { ensureProjectAgentForSessionKey } from '../services/project-agent-service';
import { isWorkflowOpenClawSessionKey } from '../../shared/workflow-openclaw-session';
import { logger } from '../utils/logger';
import {
  AGENT_EXECUTION_MEMORY_CONTEXT_MARKER,
  AGENT_MEMORY_CONTEXT_MARKER,
  prependAgentMemoryBlock,
} from '../../shared/agent-memory-prompt';
import { parseOpenClawExecutionTurn } from './openclaw-execution-snapshot';
import {
  prependSystemPromptAppend,
  wrapScheduledTaskSystemPromptAppend,
} from '../../shared/system-prompt-append';
import { logUserSend } from '../../shared/user-send-log';
import { hasPendingRuntimeToolUse, hasRuntimeAssistantOutput, inspectTranscript, runtimeRecord } from './chat-runtime-inspection';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
]);
const OPENCLAW_SESSION_STAT_CONCURRENCY = 32;

/**
 * Gateway `chat.send` schema（additionalProperties:false）不接受 `systemPromptAppend`。
 * OpenClaw 侧将 append 前置合并进 user message，使定时任务钉钉必发等上下文对模型可见。
 * 不把 append 放进 RPC 参数，避免 schema 拒收。
 */
export const mergeOpenClawSystemPromptAppend = prependSystemPromptAppend;

/** OpenClaw 没有原生 systemPromptAppend，adapter 负责按发送来源选择兼容封装。 */
export function resolveOpenClawSendMessage(
  params: Pick<EngineSendParams, 'message' | 'systemPromptAppend' | 'runtimePolicy'>,
): string {
  return params.runtimePolicy?.origin === 'scheduled_task'
    ? wrapScheduledTaskSystemPromptAppend(params.message, params.systemPromptAppend)
    : mergeOpenClawSystemPromptAppend(params.message, params.systemPromptAppend);
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  }));
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function resolveSessionFile(
  sessionsDir: string,
  entry: unknown,
): string | null {
  if (typeof entry === 'string') {
    return isAbsolutePath(entry) ? entry : join(sessionsDir, entry.endsWith('.jsonl') ? entry : `${entry}.jsonl`);
  }
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const direct = record.sessionFile ?? record.file ?? record.fileName ?? record.path;
  if (typeof direct === 'string' && direct.trim()) {
    return isAbsolutePath(direct) ? direct : join(sessionsDir, direct.endsWith('.jsonl') ? direct : `${direct}.jsonl`);
  }
  const id = record.id ?? record.sessionId;
  if (typeof id === 'string' && id.trim()) {
    return join(sessionsDir, id.endsWith('.jsonl') ? id : `${id}.jsonl`);
  }
  return null;
}

interface OpenClawSessionStoreMetadata {
  updatedAt?: number;
  spawnedBy?: string;
  label?: string;
}

function readSessionStoreEntryFields(entry: unknown): Pick<OpenClawSessionStoreMetadata, 'spawnedBy' | 'label'> {
  if (!entry || typeof entry !== 'object') return {};
  const record = entry as Record<string, unknown>;
  const spawnedBy = typeof record.spawnedBy === 'string' ? record.spawnedBy.trim() : undefined;
  const label = typeof record.label === 'string' ? record.label.trim() : undefined;
  return {
    spawnedBy: spawnedBy || undefined,
    label: label || undefined,
  };
}

async function loadOpenClawSessionStoreMetadata(): Promise<Map<string, OpenClawSessionStoreMetadata>> {
  const metadataByKey = new Map<string, OpenClawSessionStoreMetadata>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return metadataByKey;
  }
  const agentIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  await Promise.all(agentIds.map(async (agentId) => {
    const sessionsDir = join(agentsDir, agentId, 'sessions');
    const storePath = join(sessionsDir, 'sessions.json');
    let store: Record<string, unknown>;
    try {
      store = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }

    const candidates: Array<{ key: string; filePath: string; spawnedBy?: string; label?: string }> = [];
    if (Array.isArray(store.sessions)) {
      for (const item of store.sessions) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const key = typeof record.key === 'string'
          ? record.key
          : typeof record.sessionKey === 'string'
            ? record.sessionKey
            : '';
        if (!key) continue;
        const filePath = resolveSessionFile(sessionsDir, record);
        if (!filePath) continue;
        candidates.push({ key, filePath, ...readSessionStoreEntryFields(record) });
      }
    }

    for (const [key, value] of Object.entries(store)) {
      if (key === 'sessions' || !key) continue;
      const filePath = resolveSessionFile(sessionsDir, value);
      if (!filePath) continue;
      candidates.push({ key, filePath, ...readSessionStoreEntryFields(value) });
    }

    await runLimited(candidates, OPENCLAW_SESSION_STAT_CONCURRENCY, async ({ key, filePath, spawnedBy, label }) => {
      const existing = metadataByKey.get(key) ?? {};
      metadataByKey.set(key, {
        ...existing,
        spawnedBy: spawnedBy ?? existing.spawnedBy,
        label: label ?? existing.label,
      });
      try {
        const fileStat = await stat(filePath);
        metadataByKey.set(key, {
          ...metadataByKey.get(key),
          updatedAt: fileStat.mtimeMs,
        });
      } catch {
        // Ignore missing/deleted transcripts; the gateway decides visibility.
      }
    });
  }));

  return metadataByKey;
}

function sessionsFromOpenClawStoreMetadata(
  metadataByKey: Map<string, OpenClawSessionStoreMetadata>,
): EngineSessionSummary[] {
  return [...metadataByKey.entries()]
    .map(([key, storeMeta]): EngineSessionSummary => ({
      key,
      label: storeMeta.label,
      updatedAt: storeMeta.updatedAt,
      spawnedBy: storeMeta.spawnedBy,
      engineType: 'openclaw',
    }))
    .filter((entry) => Boolean(entry.key) && !isWorkflowOpenClawSessionKey(entry.key));
}

export const openClawAdapter: EngineAdapter = {
  type: 'openclaw',
  chatCapabilities: {
    hasReliableRuntimeStatus: false,
    hasStructuredReasoningEvents: false,
    hasStructuredToolEvents: false,
    requiresHistoryProjection: true,
  },

  classifyFinalMessage({ message, phase }) {
    if (phase === 'completed') return 'completed';
    const record = runtimeRecord(message);
    if (!record) return 'awaiting_transcript';
    return String(record.role ?? '').toLowerCase() === 'assistant'
      && hasRuntimeAssistantOutput(record)
      && !hasPendingRuntimeToolUse(record)
      ? 'completed'
      : 'progress';
  },

  async inspectRun(ctx, params) {
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: params.limit ?? 50,
      });
      return inspectTranscript({
        messages: Array.isArray(result.messages) ? result.messages : [],
        startedAt: params.startedAt,
        isRunning: typeof result.isRunning === 'boolean' ? result.isRunning : undefined,
        runId: params.runId,
      });
    } catch (error) {
      return { status: 'unknown', runId: params.runId ?? undefined, reason: String(error) };
    }
  },

  prepareMemoryInjection(params, memory) {
    // Keep the real user request last so skill matching is anchored to it instead of
    // to tool names or commands that may appear in recalled execution experience.
    let message = prependAgentMemoryBlock(params.message, memory.execution, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER);
    message = prependAgentMemoryBlock(message, memory.preference, AGENT_MEMORY_CONTEXT_MARKER);
    if (memory.preference || memory.execution) {
      logger.info('[agent-memory][openclaw] message after memory injection', {
        sessionKey: params.sessionKey,
        messageChars: message.length,
        preferenceChars: memory.preference?.length ?? 0,
        executionChars: memory.execution?.length ?? 0,
      });
    }
    return { ...params, message };
  },

  async listSessions(ctx: EngineAdapterContext) {
    const metadataByKey = await loadOpenClawSessionStoreMetadata();
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.list', {});
      const sessions: EngineSessionSummary[] = Array.isArray(result.sessions)
        ? result.sessions
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry): EngineSessionSummary => {
            const key = typeof entry.key === 'string' ? entry.key : '';
            const storeMeta = metadataByKey.get(key);
            return {
              key,
              label: typeof entry.label === 'string'
                ? entry.label
                : storeMeta?.label,
              displayName: typeof entry.displayName === 'string' ? entry.displayName : undefined,
              thinkingLevel: typeof entry.thinkingLevel === 'string' ? entry.thinkingLevel : undefined,
              model: typeof entry.model === 'string' ? entry.model : undefined,
              updatedAt: typeof entry.updatedAt === 'number' || typeof entry.updatedAt === 'string'
                ? entry.updatedAt
                : storeMeta?.updatedAt,
              spawnedBy: typeof entry.spawnedBy === 'string'
                ? entry.spawnedBy
                : storeMeta?.spawnedBy,
              engineType: 'openclaw',
            };
          })
          .filter((entry) => Boolean(entry.key) && !isWorkflowOpenClawSessionKey(entry.key))
        : [];
      return { success: true, result: { sessions } };
    } catch {
      // Gateway down / not connected: still list from agents/*/sessions/sessions.json
      // so the sidebar can show recent OpenClaw history offline.
      return {
        success: true,
        result: { sessions: sessionsFromOpenClawStoreMetadata(metadataByKey) },
      };
    }
  },

  async getHistory(ctx: EngineAdapterContext, params: { sessionKey: string; limit: number }) {
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: params.limit,
      });
      return {
        success: true,
        result: {
          messages: Array.isArray(result.messages) ? result.messages : [],
          thinkingLevel: typeof result.thinkingLevel === 'string' ? result.thinkingLevel : null,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async getExecutionSnapshot(ctx: EngineAdapterContext, params: { sessionKey: string; limit: number }) {
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: params.limit,
      });
      const messages = Array.isArray(result.messages)
        ? result.messages.filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === 'object')
        : [];
      return { success: true, result: parseOpenClawExecutionTurn(messages) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessage(ctx: EngineAdapterContext, params) {
    try {
      const sessionKey = params.sessionKey;
      const projectAgentResult = await ensureProjectAgentForSessionKey(sessionKey);
      if (projectAgentResult.created || projectAgentResult.workspaceUpdated) {
        await ctx.gatewayManager.debouncedReload();
      }
      const message = resolveOpenClawSendMessage(params);
      if (params.systemPromptAppend?.trim()) {
        logger.info('[openclaw-adapter][prompt] final user message after prepend', {
          sessionKey,
          appendChars: params.systemPromptAppend.trim().length,
          messageChars: message.length,
          userMessageChars: params.message.length,
        });
      }
      logUserSend({
        engine: 'openclaw',
        sessionKey,
        message,
        messageLength: message.length,
        systemPromptAppend: params.systemPromptAppend ?? null,
        systemPromptAppendLength: params.systemPromptAppend?.trim().length ?? 0,
        idempotencyKey: params.idempotencyKey,
      });
      const rpcParams: Record<string, unknown> = {
        sessionKey,
        message,
        deliver: params.deliver,
        idempotencyKey: params.idempotencyKey,
      };
      const result = await ctx.gatewayManager.rpc<{ runId?: string }>('chat.send', rpcParams, 120000);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessageWithMedia(ctx: EngineAdapterContext, params: EngineSendWithMediaParams) {
    try {
      const sessionKey = params.sessionKey;
      const projectAgentResult = await ensureProjectAgentForSessionKey(sessionKey);
      if (projectAgentResult.created || projectAgentResult.workspaceUpdated) {
        await ctx.gatewayManager.debouncedReload();
      }

      let message = resolveOpenClawSendMessage(params);
      if (params.systemPromptAppend?.trim()) {
        logger.info('[openclaw-adapter][prompt] final user message after prepend (media)', {
          sessionKey,
          appendChars: params.systemPromptAppend.trim().length,
          messageChars: message.length,
          userMessageChars: params.message.length,
        });
      }
      const imageAttachments: Array<Record<string, unknown>> = [];
      const fileReferences: string[] = [];

      for (const media of params.media ?? []) {
        fileReferences.push(`[media attached: ${media.filePath} (${media.mimeType}) | ${media.filePath}]`);
        if (VISION_MIME_TYPES.has(media.mimeType)) {
          const fileBuffer = await readFile(media.filePath);
          imageAttachments.push({
            content: fileBuffer.toString('base64'),
            mimeType: media.mimeType,
            fileName: media.fileName,
          });
        }
      }

      if (fileReferences.length > 0) {
        message = message ? `${message}\n\n${fileReferences.join('\n')}` : fileReferences.join('\n');
      }

      logUserSend({
        engine: 'openclaw',
        sessionKey: params.sessionKey,
        message,
        messageLength: message.length,
        systemPromptAppend: params.systemPromptAppend ?? null,
        systemPromptAppendLength: params.systemPromptAppend?.trim().length ?? 0,
        idempotencyKey: params.idempotencyKey,
        attachmentCount: params.media?.length ?? 0,
      });

      const rpcParams: Record<string, unknown> = {
        sessionKey: params.sessionKey,
        message,
        deliver: params.deliver ?? false,
        idempotencyKey: params.idempotencyKey,
      };

      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }

      const result = await ctx.gatewayManager.rpc<{ runId?: string }>('chat.send', rpcParams, 120000);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async abortRun(ctx: EngineAdapterContext, params) {
    try {
      await ctx.gatewayManager.rpc('chat.abort', { sessionKey: params.sessionKey });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
