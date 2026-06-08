import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { syncClaudeSkillsForAgent } from '../services/claude-skill-bridge';
import { getAgentPreferredModel, getAgentWorkspacePath } from '../utils/agent-config';
import { logger } from '../utils/logger';
import { deleteEngineSessionRegistryEntry, getEngineSessionRegistryEntry, listEngineSessionRegistryEntries, upsertEngineSessionRegistryEntry } from './session-registry';
import type { EngineAdapter, EngineAdapterContext, EngineHistoryResult, EngineSessionSummary } from './types';

type ActiveClaudeQuery = {
  close: () => void;
  runId: string;
  sessionId: string;
  sessionKey: string;
};

const activeClaudeQueries = new Map<string, ActiveClaudeQuery>();
const liveClaudeMessages = new Map<string, Array<{
  id: string;
  role: 'user' | 'assistant';
  content: unknown;
  timestamp?: number;
  isError?: boolean;
  receivedAt: number;
}>>();

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

function isSkillReplayText(text: string): boolean {
  return text.includes('Base directory for this skill:')
    || text.includes('ARGUMENTS:')
    || text.includes('Base directory for this command:');
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

  if (combinedText && isSkillReplayText(combinedText)) {
    return true;
  }

  if (typeof messagePayload === 'string' && isSkillReplayText(messagePayload)) {
    return true;
  }

  return false;
}

async function buildHistory(sessionKey: string, sessionId: string, cwd: string): Promise<EngineHistoryResult> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const sessionMessages = await sdk.getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: false });
  const persistedMessages = sessionMessages
    .filter((entry) => {
      if (entry.type === 'assistant') return true;
      if (entry.type !== 'user') return false;
      const entryRecord = entry as Record<string, unknown>;
      return !shouldHideClaudeUserMessage(entryRecord, entry.message);
    })
    .map((entry) => {
      const role = entry.type === 'assistant' ? 'assistant' : 'user';
      const entryRecord = entry as Record<string, unknown>;
      return {
        id: entry.uuid,
        role,
        content: toRawContentFromClaudeMessage(entry.message),
        timestamp: toEpochMs(entryRecord.timestamp),
        isError: false,
      };
    });
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
        sortKey: persistedMessages.length + index + (message.receivedAt / 1_000_000_000_000),
      })),
  ]
    .sort((left, right) => left.sortKey - right.sortKey)
    .map(({ id, role, content, timestamp, isError }) => ({ id, role, content, timestamp, isError }));

  await upsertEngineSessionRegistryEntry({
    sessionKey,
    sessionId,
    cwd,
    agentId: extractAgentId(sessionKey),
    engineType: 'claude',
    updatedAt: Date.now(),
  });

  return { messages: mergedMessages, thinkingLevel: null };
}

function extractAgentId(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId || 'main').trim().toLowerCase();
}

async function consumeClaudeQuery(
  sessionKey: string,
  sessionId: string,
  cwd: string,
  query: AsyncIterable<Record<string, unknown>> & { close(): void },
): Promise<void> {
  let title: string | undefined;

  try {
    for await (const message of query) {
      const messageSessionId = typeof message.session_id === 'string' ? message.session_id : sessionId;
      if (!title && message.type === 'user' && 'message' in message && !shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
        title = stringifyClaudeContent((message as { message?: unknown }).message);
      }
      if ((message.type === 'user' || message.type === 'assistant') && 'message' in message) {
        if (message.type === 'user' && shouldHideClaudeUserMessage(message, (message as { message?: unknown }).message)) {
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
    }
  } finally {
    activeClaudeQueries.delete(sessionKey);
  }
}

async function ensureClaudeRegistryEntry(sessionKey: string) {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  if (existing?.cwd) return existing;

  const agentId = extractAgentId(sessionKey);
  const cwd = await getAgentWorkspacePath(agentId);
  const preferredModel = await getAgentPreferredModel(agentId);
  if (!cwd) return existing;

  const nextEntry = {
    sessionKey,
    sessionId: existing?.sessionId,
    cwd,
    agentId,
    engineType: 'claude' as const,
    updatedAt: existing?.updatedAt ?? Date.now(),
    title: existing?.title,
    model: existing?.model ?? preferredModel.model,
    accountId: existing?.accountId ?? preferredModel.accountId,
  };
  await upsertEngineSessionRegistryEntry(nextEntry);
  return nextEntry;
}

async function startClaudeQuery(
  sessionKey: string,
  message: string,
  options?: {
    additionalDirectories?: string[];
  },
): Promise<{ success: boolean; result?: { runId: string }; error?: string }> {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const existing = await ensureClaudeRegistryEntry(sessionKey);
    const cwd = existing?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${sessionKey} is missing workspace cwd` };
    }

    const agentId = extractAgentId(sessionKey);
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
    const query = sdk.query({
      prompt: message,
      options: existing?.sessionId
        ? {
          cwd,
          resume: existing.sessionId,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          settingSources: ['project', 'user'],
          skills: 'all',
          settings: existing?.model ? { model: existing.model } : undefined,
          additionalDirectories: options?.additionalDirectories,
        }
        : {
          cwd,
          sessionId,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          settingSources: ['project', 'user'],
          skills: 'all',
          settings: existing?.model ? { model: existing.model } : undefined,
          additionalDirectories: options?.additionalDirectories,
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
      model: existing?.model,
      accountId: existing?.accountId,
    });

    void consumeClaudeQuery(sessionKey, sessionId, cwd, query as AsyncIterable<Record<string, unknown>> & { close(): void }).catch((error) => {
      logger.error('Claude query failed:', error);
      cacheClaudeErrorMessage(sessionKey, error);
      void upsertEngineSessionRegistryEntry({
        sessionKey,
        sessionId,
        cwd,
        agentId: extractAgentId(sessionKey),
        engineType: 'claude',
        updatedAt: Date.now(),
        model: existing?.model,
        accountId: existing?.accountId,
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
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  liveClaudeMessages.delete(sessionKey);
  if (!entry?.sessionId) {
    await deleteEngineSessionRegistryEntry(sessionKey);
    return;
  }

  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  await sdk.deleteSession(entry.sessionId, { dir: entry.cwd });
  await deleteEngineSessionRegistryEntry(sessionKey);
}

export const claudeAdapter: EngineAdapter = {
  type: 'claude',

  async listSessions() {
    const entries = await listEngineSessionRegistryEntries('claude');
    const sessions: EngineSessionSummary[] = entries.map((entry) => ({
      key: entry.sessionKey,
      label: entry.title,
      displayName: entry.title,
      updatedAt: entry.updatedAt,
      engineType: 'claude',
    }));
    return { success: true, result: { sessions } };
  },

  async getHistory(_ctx, params) {
    const entry = await ensureClaudeRegistryEntry(params.sessionKey);
    if (!entry?.sessionId) {
      return { success: true, result: { messages: [], thinkingLevel: null } };
    }

    try {
      const result = await buildHistory(params.sessionKey, entry.sessionId, entry.cwd);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessage(_ctx: EngineAdapterContext, params) {
    return startClaudeQuery(params.sessionKey, params.message);
  },

  async sendMessageWithMedia(_ctx, params) {
    const mediaPreamble = (params.media ?? [])
      .map((item) => `[media attached: ${resolve(item.filePath)} (${item.mimeType}) | ${resolve(item.filePath)}]`)
      .join('\n');
    const nextMessage = mediaPreamble ? `${params.message}\n\n${mediaPreamble}` : params.message;
    const entry = await ensureClaudeRegistryEntry(params.sessionKey);
    const cwd = entry?.cwd;
    if (!cwd) {
      return { success: false, error: `Claude session ${params.sessionKey} is missing workspace cwd` };
    }
    const additionalDirectories = getAdditionalDirectories(cwd, params.media ?? []);
    return startClaudeQuery(params.sessionKey, nextMessage, { additionalDirectories });
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
