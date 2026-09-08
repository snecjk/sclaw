import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';

export type LiveProcessActivity =
  | { kind: 'tool'; name: string }
  | { kind: 'thinking' }
  | { kind: 'idle' };

export function resolveLiveProcessActivity(
  timeline: readonly ThinkingTimelineItem[],
  streamingTools: readonly { name: string; status?: string }[] = [],
): LiveProcessActivity {
  const running = [...streamingTools].reverse().find((tool) => tool.status === 'running');
  if (running?.name) return { kind: 'tool', name: running.name };

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.type === 'tool' && item.name) return { kind: 'tool', name: item.name };
    if (item?.type === 'thinking') return { kind: 'thinking' };
  }

  return { kind: 'idle' };
}
