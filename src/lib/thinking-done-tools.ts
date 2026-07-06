import type { RawMessage } from '@/stores/chat';
import { collectToolUpdates } from '@/stores/chat/helpers';
import { extractToolUse } from '@/pages/Chat/message-utils';
import type { CachedTurnStreamingTool } from '@/lib/thinking-turn-tools-cache';
import { readTurnStreamingToolsCache } from '@/lib/thinking-turn-tools-cache';

function normalizeCachedTool(tool: CachedTurnStreamingTool): CachedTurnStreamingTool {
  return {
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
    input: tool.input,
    status: tool.status ?? 'completed',
  };
}

function dedupeStreamingTools(tools: CachedTurnStreamingTool[]): CachedTurnStreamingTool[] {
  const seen = new Set<string>();
  const result: CachedTurnStreamingTool[] = [];
  for (const tool of tools) {
    const key = tool.toolCallId || tool.id || tool.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalizeCachedTool(tool));
  }
  return result;
}

/** 从 assistant snapshot 提取 tool_use（Claude loadHistory 后可能只剩 thinking/text） */
export function extractStreamingToolsFromTurnMessages(
  turnMessages: readonly RawMessage[],
): CachedTurnStreamingTool[] {
  const tools: CachedTurnStreamingTool[] = [];
  for (const message of turnMessages) {
    for (const block of extractToolUse(message)) {
      tools.push({
        id: block.id || undefined,
        toolCallId: block.id || undefined,
        name: block.name,
        input: block.input,
        status: 'completed',
      });
    }
  }
  return dedupeStreamingTools(tools);
}

/** runtime 缓存的 tool_result 行（不进 messages[]）→ 完成态 parse 补工具 */
export function extractStreamingToolsFromToolResults(
  toolResults: readonly RawMessage[],
): CachedTurnStreamingTool[] {
  const tools: CachedTurnStreamingTool[] = [];
  for (const message of toolResults) {
    for (const update of collectToolUpdates(message, 'final')) {
      if (!update.name) continue;
      tools.push({
        id: update.id,
        toolCallId: update.toolCallId ?? update.id,
        name: update.name,
        input: update.input,
        status: update.status,
      });
    }
  }
  return dedupeStreamingTools(tools);
}

export interface ResolveDoneTurnStreamingToolsParams {
  turnStableKey?: string;
  aliasKeys?: string[];
  turnMessages: readonly RawMessage[];
  toolResults: readonly RawMessage[];
}

/**
 * Claude 完成态工具来源（按优先级）：
 * 1. 模块 cache（流式期间写入）
 * 2. turn assistant snapshot 里的 tool_use
 * 3. 缓存的 tool_result 行
 */
export function resolveDoneTurnStreamingTools(
  params: ResolveDoneTurnStreamingToolsParams,
): CachedTurnStreamingTool[] {
  const cached = readTurnStreamingToolsCache(params.turnStableKey, params.aliasKeys ?? []);
  if (cached.length > 0) return cached;

  const fromMessages = extractStreamingToolsFromTurnMessages(params.turnMessages);
  if (fromMessages.length > 0) return fromMessages;

  return extractStreamingToolsFromToolResults(params.toolResults);
}
