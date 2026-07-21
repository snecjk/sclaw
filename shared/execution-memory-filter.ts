/**
 * 跨进程共享的「记忆检索结果过滤」纯函数。
 *
 * renderer 注入端（src/lib/agent-execution-memory.ts 的 results() / src/lib/agent-memory.ts
 * 的 normalize）与 main 进程 dedup 预检（memory-capture-service）共用本函数，保证
 * "会被注入的记忆"与"去重比对是否已沉淀过的记忆"用同一套判别标准。
 *
 * 判别维度：metadata.memoryScope（'execution' = 执行经验，其余 = 普通偏好）。
 * mem0 检索结果的 metadata 可能嵌套在 metadata.payload 里，这里做合并展开。
 */

export type ExecutionMemorySearchResult = {
  id?: string;
  memory?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

export type ExecutionMemoryItem = {
  id?: string;
  /** 记忆原文（未截断，由调用方按需截断）。 */
  memory: string;
  score?: number;
  metadata: Record<string, unknown>;
};

/**
 * 从一条 mem0 检索结果中提取 metadata（处理 metadata.payload 嵌套）。
 */
function extractMetadata(result: ExecutionMemorySearchResult): Record<string, unknown> {
  const raw = result.metadata && typeof result.metadata === 'object'
    ? result.metadata
    : result.payload && typeof result.payload === 'object'
      ? result.payload
      : {};
  const nested = raw.payload && typeof raw.payload === 'object'
    ? raw.payload as Record<string, unknown>
    : {};
  return { ...raw, ...nested };
}

function extractMemoryText(result: ExecutionMemorySearchResult, metadata: Record<string, unknown>): string {
  return typeof result.memory === 'string'
    ? result.memory
    : typeof metadata.memory === 'string'
      ? metadata.memory
      : typeof metadata.data === 'string'
        ? metadata.data
        : '';
}

type MemoryMatchPredicate = (metadata: Record<string, unknown>) => boolean;

/**
 * 核心提取：从 mem0 检索载荷中，按 predicate 过滤出符合的记忆，按 score 降序返回
 * （未截断、未切片，由调用方处理）。
 */
function extractMemories(payload: unknown, match: MemoryMatchPredicate): ExecutionMemoryItem[] {
  const source = Array.isArray((payload as { results?: unknown[] } | null)?.results)
    ? (payload as { results: ExecutionMemorySearchResult[] }).results
    : [];
  const items: ExecutionMemoryItem[] = [];
  for (const result of source) {
    const metadata = extractMetadata(result);
    if (!match(metadata)) continue;
    const memory = extractMemoryText(result, metadata);
    if (!memory) continue;
    items.push({
      id: result.id,
      memory,
      score: typeof result.score === 'number' ? result.score : undefined,
      metadata,
    });
  }
  return items.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

/**
 * 提取「active 执行经验」记忆：memoryScope==='execution' && (status 缺省或 'active')
 * && (confidence 非 number 或 >= 0.5)。与注入端判别一致。
 */
export function extractActiveExecutionMemories(payload: unknown): ExecutionMemoryItem[] {
  return extractMemories(payload, (m) => {
    if (m.memoryScope !== 'execution') return false;
    if (m.status && m.status !== 'active') return false;
    if (typeof m.confidence === 'number' && m.confidence < 0.5) return false;
    return true;
  });
}

/**
 * 提取「普通偏好」记忆：memoryScope !== 'execution'（即偏好或无 scope）。
 * 排除所有执行类记忆，避免执行经验泄漏进偏好 block。不做 active/confidence 过滤，
 * 与原 normalizeMemorySearchResults 的"全收"行为对齐。
 */
export function extractPreferenceMemories(payload: unknown): ExecutionMemoryItem[] {
  return extractMemories(payload, (m) => m.memoryScope !== 'execution');
}
