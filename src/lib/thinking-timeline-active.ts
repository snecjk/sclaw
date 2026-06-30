import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';

type StreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
};

export function toolRowKey(tool: Extract<ThinkingTimelineItem, { type: 'tool' }>): string {
  return tool.id || `tool-${tool.index}`;
}

export function streamingToolKey(tool: StreamingTool): string {
  return tool.toolCallId || tool.id || tool.name;
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

export function timelineBlockResetKey(
  item: ThinkingTimelineItem,
  index: number,
): string {
  if (item.type === 'tool') {
    return `tool-${toolRowKey(item)}`;
  }
  return `thinking-${index}`;
}
