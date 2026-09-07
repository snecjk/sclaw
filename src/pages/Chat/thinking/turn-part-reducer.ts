/**
 * TurnPart reducer — 按时间序归一 events + streamingTools（Phase 2）
 *
 * 规则：只追加、同 identity 工具合并 input、identity 不含 input。
 */
import {
  mergeToolInput,
  resolveToolIdentity,
  resolveToolInputState,
} from '@/lib/tool-input-merge';
import { isStableToolId, resolveStreamingToolId } from '@/lib/thinking-timeline-active';
import type { RawTurnEvent } from '@/pages/Chat/thinking/types';
import type {
  ReduceTurnPartsOptions,
  ToolCallTurnPart,
  TurnPart,
} from '@/pages/Chat/thinking/turn-parts';

type ToolAccumulator = {
  part: ToolCallTurnPart;
  weakOccurrenceIndex?: number;
};

function sourceForStream(isLiveStream: boolean): 'live' | 'history' {
  return isLiveStream ? 'live' : 'history';
}

function upsertToolPart(
  byIdentity: Map<string, ToolAccumulator>,
  tool: {
    id: string;
    name: string;
    input?: unknown;
    status?: 'running' | 'completed' | 'error';
    source: ToolCallTurnPart['source'];
    order: number;
  },
  weakOccurrenceByName: Map<string, number>,
): void {
  let occurrenceIndex: number | undefined;
  if (!isStableToolId(tool.id, tool.name)) {
    const next = weakOccurrenceByName.get(tool.name) ?? 0;
    if (!byIdentity.has(resolveToolIdentity({ id: tool.id, name: tool.name }, next))) {
      occurrenceIndex = next;
      weakOccurrenceByName.set(tool.name, next + 1);
    } else {
      occurrenceIndex = next - 1;
    }
  }

  const identity = resolveToolIdentity(
    { id: tool.id, name: tool.name },
    occurrenceIndex,
  );
  const existing = byIdentity.get(identity);
  const mergedInput = mergeToolInput(existing?.part.input, tool.input);
  const status = tool.status ?? existing?.part.status ?? 'completed';
  const inputState = resolveToolInputState(mergedInput, status);

  const part: ToolCallTurnPart = {
    id: existing?.part.id ?? `tool-${identity}`,
    kind: 'tool_call',
    firstSeenOrder: existing?.part.firstSeenOrder ?? tool.order,
    source: existing?.part.source ?? tool.source,
    status,
    toolIdentity: identity,
    toolCallId: isStableToolId(tool.id, tool.name) ? tool.id : undefined,
    name: tool.name,
    input: mergedInput,
    inputState,
  };

  byIdentity.set(identity, {
    part,
    weakOccurrenceIndex: occurrenceIndex,
  });
}

/**
 * 从 merged raw events + streamingTools 产出稳定 TurnPart[]。
 * 工具按 identity 去重；text/thinking 按首次出现顺序追加。
 */
export function reduceTurnParts(
  events: RawTurnEvent[],
  options: ReduceTurnPartsOptions,
): TurnPart[] {
  const parts: TurnPart[] = [];
  const toolByIdentity = new Map<string, ToolAccumulator>();
  const weakOccurrenceByName = new Map<string, number>();
  let order = 0;
  const source = sourceForStream(options.isLiveStream);

  for (const event of events) {
    if (event.type === 'text') {
      parts.push({
        id: `text-${order}`,
        kind: 'process_text',
        firstSeenOrder: order,
        source,
        text: event.text,
      });
      order += 1;
      continue;
    }

    if (event.type === 'thinking') {
      parts.push({
        id: `reasoning-${order}`,
        kind: 'reasoning',
        firstSeenOrder: order,
        source,
        content: event.content,
      });
      order += 1;
      continue;
    }

    upsertToolPart(
      toolByIdentity,
      {
        id: event.id,
        name: event.name,
        input: event.input,
        status: options.isLiveStream ? 'running' : 'completed',
        source,
        order,
      },
      weakOccurrenceByName,
    );
    order += 1;
  }

  for (const tool of options.streamingTools ?? []) {
    const id = resolveStreamingToolId(tool);
    upsertToolPart(
      toolByIdentity,
      {
        id,
        name: tool.name,
        input: tool.input,
        status: tool.status ?? (options.isLiveStream ? 'running' : 'completed'),
        source: 'cache',
        order,
      },
      weakOccurrenceByName,
    );
    order += 1;
  }

  const toolParts = Array.from(toolByIdentity.values())
    .map((entry) => entry.part)
    .sort((a, b) => a.firstSeenOrder - b.firstSeenOrder);

  // 交错：按 firstSeenOrder 合并非 tool 与 tool parts
  const merged: TurnPart[] = [...parts];
  for (const toolPart of toolParts) {
    const insertAt = merged.findIndex(
      (part) => part.firstSeenOrder > toolPart.firstSeenOrder,
    );
    if (insertAt < 0) {
      merged.push(toolPart);
    } else {
      merged.splice(insertAt, 0, toolPart);
    }
  }

  return merged.sort((a, b) => a.firstSeenOrder - b.firstSeenOrder);
}

/** 供 adapter 查询：identity → 合并后的 tool part */
export function buildToolPartLookup(parts: TurnPart[]): Map<string, ToolCallTurnPart> {
  const map = new Map<string, ToolCallTurnPart>();
  /**
   * name 只是兜底键。同名多次调用时它会互相覆盖，查回来的是「最后一次」的 input——
   * 曾导致同轮 3 次 exec 被补成同一份参数、随后当成重复项合并掉。歧义时宁可查不到。
   */
  const ambiguousNames = new Set<string>();

  for (const part of parts) {
    if (part.kind !== 'tool_call') continue;
    map.set(part.toolIdentity, part);
    if (part.toolCallId) {
      map.set(part.toolCallId, part);
    }
    if (ambiguousNames.has(part.name)) continue;
    if (map.has(part.name)) {
      ambiguousNames.add(part.name);
      map.delete(part.name);
      continue;
    }
    map.set(part.name, part);
  }
  return map;
}

export function appendInterruptedPart(parts: TurnPart[]): TurnPart[] {
  const maxOrder = parts.reduce((max, part) => Math.max(max, part.firstSeenOrder), -1);
  return [
    ...parts,
    {
      id: 'interrupted-marker',
      kind: 'interrupted',
      firstSeenOrder: maxOrder + 1,
      source: 'live',
      status: 'interrupted',
      labelKey: 'streaming.interrupted',
    } satisfies TurnPart,
  ];
}
