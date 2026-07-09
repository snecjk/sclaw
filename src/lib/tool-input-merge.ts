/**
 * 工具 input 质量合并 — Phase 1 止血 + Phase 3 identity
 *
 * 同一 tool 的 input 可被更高质量来源补全；空值不能覆盖已有非空 input。
 * identity 不含 input（Phase 3 统一 dedupe）。
 */
import { isStableToolId } from '@/lib/thinking-timeline-active';

export type ToolInputState = 'unknown' | 'partial' | 'complete' | 'none';

export type ToolIdentityLike = {
  id?: string;
  toolCallId?: string;
  name: string;
};

/**
 * 工具 logical identity — 不含 input。
 * 稳定 id 优先；弱 id 用 name + occurrenceIndex 区分同轮多次调用。
 */
export function resolveToolIdentity(
  tool: ToolIdentityLike,
  occurrenceIndex?: number,
): string {
  const stableId = tool.toolCallId || tool.id;
  if (isStableToolId(stableId, tool.name)) return stableId;
  if (typeof occurrenceIndex === 'number') {
    return `occurrence::${tool.name}::${occurrenceIndex}`;
  }
  return stableId || tool.name;
}

/** Timeline / segment 去重 key（identity only，禁止拼 input） */
export function thinkingTimelineToolIdentityKey(tool: {
  id: string;
  name: string;
  toolCallId?: string;
}): string {
  return resolveToolIdentity({
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
  });
}

/** 是否有可展示/可合并的业务 input（非 null/undefined/空串；空 object 视为无意义占位） */
export function hasMeaningfulToolInput(input: unknown): boolean {
  if (input == null) return false;
  if (typeof input === 'string') return input.trim().length > 0;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(input as Record<string, unknown>).length > 0;
  }
  return true;
}

/** 合并 input：incoming 有意义则覆盖，否则保留 existing */
export function mergeToolInput(existing: unknown, incoming: unknown): unknown {
  if (hasMeaningfulToolInput(incoming)) return incoming;
  if (hasMeaningfulToolInput(existing)) return existing;
  return incoming ?? existing;
}

export function resolveToolInputState(
  input: unknown,
  status: 'running' | 'completed' | 'error',
  options?: { confirmedEmpty?: boolean },
): ToolInputState {
  if (hasMeaningfulToolInput(input)) return 'complete';
  if (options?.confirmedEmpty) return 'none';
  if (status === 'running') return 'unknown';
  // 完成态空 input：Phase 1 保守标 unknown，避免 cache 占位误显示「无参数」
  return 'unknown';
}

export function streamingToolCacheKey(tool: {
  toolCallId?: string;
  id?: string;
  name: string;
}): string {
  return tool.toolCallId || tool.id || tool.name;
}

export function mergeStreamingToolRecords<T extends {
  toolCallId?: string;
  id?: string;
  name: string;
  input?: unknown;
  status?: 'running' | 'completed' | 'error';
}>(
  base: readonly T[],
  incoming: readonly T[],
): T[] {
  const byKey = new Map<string, T>();
  const upsert = (tool: T) => {
    const key = streamingToolCacheKey(tool);
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...tool });
      return;
    }
    byKey.set(key, {
      ...existing,
      ...tool,
      name: tool.name || existing.name,
      input: mergeToolInput(existing.input, tool.input),
      status: mergeStreamingToolStatus(existing.status, tool.status),
    });
  };
  for (const tool of base) upsert(tool);
  for (const tool of incoming) upsert(tool);
  return Array.from(byKey.values());
}

function mergeStreamingToolStatus(
  existing: 'running' | 'completed' | 'error' | undefined,
  incoming: 'running' | 'completed' | 'error' | undefined,
): 'running' | 'completed' | 'error' | undefined {
  const order: Record<'running' | 'completed' | 'error', number> = {
    running: 0,
    completed: 1,
    error: 2,
  };
  if (!existing) return incoming;
  if (!incoming) return existing;
  return order[incoming] >= order[existing] ? incoming : existing;
}

/** 从 Anthropic/OpenAI content block 或 function 对象解析 tool input */
export function parseToolBlockInput(block: Record<string, unknown>): unknown {
  if (block.input !== undefined && block.input !== null) return block.input;
  if (block.arguments !== undefined && block.arguments !== null) {
    return parseOpenAiArguments(block.arguments);
  }
  return undefined;
}

export function parseOpenAiArguments(argsRaw: unknown): unknown {
  if (typeof argsRaw === 'string') {
    const trimmed = argsRaw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return argsRaw;
    }
  }
  if (argsRaw !== undefined && argsRaw !== null) return argsRaw;
  return undefined;
}
