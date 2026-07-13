import type { RawMessage } from '@/stores/chat';
import { mergeStreamingToolRecords } from '@/lib/tool-input-merge';

/** parse / UI 补工具用的 streamingTools 形态 */
export type CachedTurnStreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  status?: 'running' | 'completed' | 'error';
};

type TurnToolsCacheEntry = {
  streamingTools: CachedTurnStreamingTool[];
  toolResults: RawMessage[];
  updatedAt: number;
};

const turnToolsCache = new Map<string, TurnToolsCacheEntry>();

function emptyEntry(): TurnToolsCacheEntry {
  return { streamingTools: [], toolResults: [], updatedAt: 0 };
}

function normalizeStreamingTool(tool: CachedTurnStreamingTool): CachedTurnStreamingTool {
  return {
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
    input: tool.input,
    status: tool.status,
  };
}

/** live 每帧 / runtime 事件：写入本轮工具状态（跨 remount + loadHistory 后 parse 补全） */
export function writeTurnStreamingToolsCache(
  turnStableKey: string | undefined,
  streamingTools: CachedTurnStreamingTool[],
): void {
  if (!turnStableKey || streamingTools.length === 0) return;
  const prev = turnToolsCache.get(turnStableKey) ?? emptyEntry();
  const merged = mergeStreamingToolRecords(
    prev.streamingTools,
    streamingTools.map(normalizeStreamingTool),
  );
  turnToolsCache.set(turnStableKey, {
    ...prev,
    streamingTools: merged,
    updatedAt: Date.now(),
  });
}

/** tool_result final 事件：Gateway 不会把 tool_result 行留在 messages[]，单独缓存供完成态 parse */
export function appendTurnToolResultCache(
  turnStableKey: string | undefined,
  toolResultMessage: RawMessage,
): void {
  if (!turnStableKey) return;
  const prev = turnToolsCache.get(turnStableKey) ?? emptyEntry();
  const toolCallId =
    typeof toolResultMessage.toolCallId === 'string' ? toolResultMessage.toolCallId : null;
  const already = prev.toolResults.some(
    (message) =>
      (typeof message.toolCallId === 'string' && message.toolCallId === toolCallId)
      || message === toolResultMessage,
  );
  if (already) return;
  turnToolsCache.set(turnStableKey, {
    ...prev,
    toolResults: [...prev.toolResults, toolResultMessage],
    updatedAt: Date.now(),
  });
}

export function readTurnStreamingToolsCache(
  turnStableKey: string | undefined,
  aliasKeys: string[] = [],
): CachedTurnStreamingTool[] {
  const keys = [turnStableKey, ...aliasKeys].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  for (const key of keys) {
    const tools = turnToolsCache.get(key)?.streamingTools;
    if (tools && tools.length > 0) return tools;
  }
  return [];
}

export function readTurnToolResultsCache(
  turnStableKey: string | undefined,
  aliasKeys: string[] = [],
): RawMessage[] {
  const keys = [turnStableKey, ...aliasKeys].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  for (const key of keys) {
    const results = turnToolsCache.get(key)?.toolResults;
    if (results && results.length > 0) return results;
  }
  return [];
}
