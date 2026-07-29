import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  input?: unknown;
};

type ToolIdentityLike = {
  id?: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
};

type TimelineToolLike = {
  id: string;
  name: string;
  input?: unknown;
};

/** Claude SDK / parse 侧真实 tool id；排除 name 回退与 tool-N 合成 id */
export function isStableToolId(id: string | undefined, name: string): boolean {
  if (!id) return false;
  if (id === name) return false;
  if (/^tool-\d+$/.test(id)) return false;
  return true;
}

export function resolveStreamingToolId(tool: ToolIdentityLike): string {
  return tool.toolCallId || tool.id || tool.name;
}

export function toolRowKey(tool: Extract<ThinkingTimelineItem, { type: 'tool' }>): string {
  const stableId = tool.id;
  if (isStableToolId(stableId, tool.name)) return stableId;
  return stableId || `tool-${tool.index}`;
}

export function streamingToolKey(tool: StreamingTool): string {
  return resolveStreamingToolId(tool);
}

/** streamingTools 条目是否对应 timeline 里已有同一 logical tool call */
export function streamingToolMatchesTimelineTool(
  streaming: ToolIdentityLike,
  timelineTool: TimelineToolLike,
): boolean {
  const streamId = resolveStreamingToolId(streaming);
  if (streamId === timelineTool.id) return true;
  if (isStableToolId(streamId, streaming.name) && streamId === timelineTool.id) return true;
  if (isStableToolId(timelineTool.id, timelineTool.name) && streamId === timelineTool.id) return true;

  if (streaming.name !== timelineTool.name) return false;

  const streamIsWeak =
    !isStableToolId(streamId, streaming.name);
  const timelineIsWeak =
    !isStableToolId(timelineTool.id, timelineTool.name);

  if (streamIsWeak || timelineIsWeak) return true;

  return false;
}

/** parse 合并 / supplemental 用：弱 id（name / tool-N）是否应视为重复 */
export function isWeakToolIdentity(id: string | undefined, name: string): boolean {
  return !isStableToolId(id, name);
}

/**
 * 流式进行中时，仅最后一个「仍在写入」的 timeline 块做打字机。
 * 已完成 / 历史块返回 null（不做打字机）。
 */
export function resolveActiveTimelineIndex(
  timeline: ThinkingTimelineItem[],
  opts: {
    isLiveStream: boolean;
    runningTool?: StreamingTool;
  },
): number | null {
  if (!opts.isLiveStream || timeline.length === 0) return null;

  if (opts.runningTool) {
    const runKey = streamingToolKey(opts.runningTool);
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const item = timeline[i];
      if (item.type === 'tool' && toolRowKey(item) === runKey) {
        return i;
      }
    }
    return timeline.length - 1;
  }

  const last = timeline[timeline.length - 1];
  if (last.type === 'thinking') {
    return timeline.length - 1;
  }

  return null;
}

/** 块 identity：rebalance 后 index 可能变，thinking/narration 用内容前缀指纹 */
function hashTimelineTextProbe(probe: string): string {
  let hash = 0;
  for (let i = 0; i < probe.length; i += 1) {
    hash = (hash * 31 + probe.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function timelineBlockResetKey(
  item: ThinkingTimelineItem,
  index: number,
): string {
  if (item.type === 'tool') {
    return `tool-${toolRowKey(item)}`;
  }
  if (item.type === 'narration') {
    const probe = item.content.trim().slice(0, 64);
    if (probe.length > 0) {
      return `narration-${hashTimelineTextProbe(probe)}`;
    }
    return `narration-${index}`;
  }
  const probe = item.content.trim().slice(0, 64);
  if (probe.length > 0) {
    return `thinking-${hashTimelineTextProbe(probe)}`;
  }
  return `thinking-${index}`;
}

function isGrowingThinkingSnapshot(
  cached: ThinkingTimelineItem,
  incoming: ThinkingTimelineItem,
): boolean {
  if (cached.type !== 'thinking' || incoming.type !== 'thinking') return false;
  const cachedText = cached.content.trim();
  const incomingText = incoming.content.trim();
  if (!cachedText || !incomingText) return false;
  return incomingText.startsWith(cachedText) || cachedText.startsWith(incomingText);
}

/**
 * 流式展示单调合并：解析器 rebundle 后条数不变但 index/key 可能变，保留用户已看到的顺序。
 */
export function mergeTimelineMonotonic(
  cached: ThinkingTimelineItem[],
  incoming: ThinkingTimelineItem[],
): ThinkingTimelineItem[] {
  if (incoming.length === 0) return cached;
  if (cached.length === 0) return incoming;
  if (incoming.length > cached.length) return incoming;
  if (incoming.length < cached.length) return cached;

  // Claude thinking deltas are emitted as a growing snapshot ("The" →
  // "The user wants..."). Their content-derived reset key changes while the
  // first 64 characters grow, but they are still the same logical block.
  // Reconcile a positionally identical timeline before key-based monotonic
  // merging so the old prefix is not retained as a second panel. Prefer the
  // longer thinking snapshot in case a later parse temporarily shrinks.
  const positionallyCompatible = cached.every((item, index) => {
    const next = incoming[index];
    if (!next) return false;
    return isGrowingThinkingSnapshot(item, next)
      || timelineBlockResetKey(item, index) === timelineBlockResetKey(next, index);
  });
  if (positionallyCompatible) {
    return incoming.map((item, index) => {
      const previous = cached[index];
      if (
        previous?.type !== 'thinking'
        || item.type !== 'thinking'
        || !isGrowingThinkingSnapshot(previous, item)
      ) return item;
      return item.content.trim().length >= previous.content.trim().length ? item : previous;
    });
  }

  const cachedKeys = cached.map((item, index) => timelineBlockResetKey(item, index));
  const incomingKeys = incoming.map((item, index) => timelineBlockResetKey(item, index));
  if (cachedKeys.join('\0') === incomingKeys.join('\0')) {
    return incoming;
  }

  const incomingByKey = new Map<string, ThinkingTimelineItem>();
  for (let index = 0; index < incoming.length; index += 1) {
    incomingByKey.set(timelineBlockResetKey(incoming[index]!, index), incoming[index]!);
  }

  const merged: ThinkingTimelineItem[] = [];
  for (let index = 0; index < cached.length; index += 1) {
    const key = timelineBlockResetKey(cached[index]!, index);
    merged.push(incomingByKey.get(key) ?? cached[index]!);
    incomingByKey.delete(key);
  }
  for (const item of incomingByKey.values()) {
    merged.push(item);
  }

  return merged.length >= cached.length ? merged : cached;
}

export type StreamingToolLike = {
  id?: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  status?: 'running' | 'completed' | 'error';
};

/** 无 input 的占位条目：running 或已有稳定 tool id 的 completed 才追加 */
export function shouldAppendStreamingExtraTool(tool: StreamingToolLike): boolean {
  if (tool.input !== undefined && tool.input !== null) return true;
  if (tool.status === 'running') return true;
  const id = resolveStreamingToolId(tool as StreamingTool);
  if (tool.status === 'completed' && isStableToolId(id, tool.name)) return true;
  return false;
}

/** 用 streamingTools 回填 timeline 里 tool 条目的 input（尚未写入 message 时） */
export function enrichTimelineWithStreamingToolInputs(
  timeline: ThinkingTimelineItem[],
  streamingTools: StreamingToolLike[],
): ThinkingTimelineItem[] {
  if (streamingTools.length === 0) return timeline;

  const inputByKey = new Map<string, unknown>();
  for (const tool of streamingTools) {
    const keys = [
      streamingToolKey(tool as StreamingTool),
      tool.toolCallId,
      tool.id,
      tool.name,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    for (const key of keys) {
      if (tool.input !== undefined && tool.input !== null) {
        inputByKey.set(key, tool.input);
      }
    }
  }

  return timeline.map((item) => {
    if (item.type !== 'tool' || item.input != null) return item;
    const input =
      inputByKey.get(toolRowKey(item))
      ?? inputByKey.get(item.id)
      ?? inputByKey.get(item.name);
    if (input === undefined || input === null) return item;
    return { ...item, input };
  });
}

/**
 * 将尚未落入 message / parse timeline 的 streamingTools 追加到 timeline。
 * live 展示与完成态 cache 烘焙共用，避免回合结束后工具条数骤降。
 */
export function appendStreamingExtrasToTimeline(
  timeline: ThinkingTimelineItem[],
  streamingTools: StreamingToolLike[],
): ThinkingTimelineItem[] {
  if (streamingTools.length === 0) return timeline;

  const enriched = enrichTimelineWithStreamingToolInputs(timeline, streamingTools);
  const timelineTools = enriched.filter(
    (item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool',
  );
  const knownKeys = new Set(timelineTools.map(toolRowKey));

  const extras: ThinkingTimelineItem[] = [];
  let nextIndex = timelineTools.length;

  for (const tool of streamingTools) {
    if (!shouldAppendStreamingExtraTool(tool)) continue;

    const key = streamingToolKey(tool as StreamingTool);
    if (knownKeys.has(key)) continue;
    if (timelineTools.some((item) => streamingToolMatchesTimelineTool(tool, item))) {
      continue;
    }
    nextIndex += 1;
    const id = resolveStreamingToolId(tool);
    extras.push({
      type: 'tool',
      index: nextIndex,
      id,
      name: tool.name,
      input: tool.input ?? null,
    });
    knownKeys.add(key);
  }

  return extras.length > 0 ? [...enriched, ...extras] : enriched;
}
