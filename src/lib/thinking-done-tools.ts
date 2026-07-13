import type { RawMessage } from '@/stores/chat';
import { collectToolUpdates } from '@/stores/chat/helpers';
import { extractToolUse } from '@/pages/Chat/message-utils';
import type { CachedTurnStreamingTool } from '@/lib/thinking-turn-tools-cache';
import { readTurnStreamingToolsCache } from '@/lib/thinking-turn-tools-cache';
import { mergeStreamingToolRecords } from '@/lib/tool-input-merge';

function normalizeCachedTool(tool: CachedTurnStreamingTool): CachedTurnStreamingTool {
  return {
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
    input: tool.input,
    status: tool.status ?? 'completed',
  };
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
  return tools;
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
  return tools;
}

export interface ResolveDoneTurnStreamingToolsParams {
  turnStableKey?: string;
  aliasKeys?: string[];
  turnMessages: readonly RawMessage[];
  toolResults: readonly RawMessage[];
}

/**
 * Claude 完成态工具来源：合并 cache + tool_result + assistant tool_use。
 * input 按质量合并（message tool_use 优先于 cache 占位）。
 */
export function resolveDoneTurnStreamingTools(
  params: ResolveDoneTurnStreamingToolsParams,
): CachedTurnStreamingTool[] {
  const cached = readTurnStreamingToolsCache(params.turnStableKey, params.aliasKeys ?? [])
    .map(normalizeCachedTool);
  const fromToolResults = extractStreamingToolsFromToolResults(params.toolResults);
  const fromMessages = extractStreamingToolsFromTurnMessages(params.turnMessages);

  const merged = mergeStreamingToolRecords(
    mergeStreamingToolRecords(cached, fromToolResults),
    fromMessages,
  );
  return merged.map(normalizeCachedTool);
}
