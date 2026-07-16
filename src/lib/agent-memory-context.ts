import { invokeIpc } from '@/lib/api-client';
import { resolveAgentMemoryUserId, shouldRetrieveMemories, buildAgentMemoryContextText } from '@/lib/agent-memory';
import { buildAgentExecutionMemoryContextText } from '@/lib/agent-execution-memory';
import { extractActiveExecutionMemories, extractPreferenceMemories } from '../../shared/execution-memory-filter';

export type InjectedExecutionMemory = { memoryId: string; memory: string };
export type AgentMemoryContextBlocks = {
  preference?: string;
  execution?: string;
  /** 仅包含最终进入 prompt 的执行经验，供回合结束后的经验替换判定使用。 */
  injectedExecutionMemories: InjectedExecutionMemory[];
};

// 与各 block 原先的截断/上限对齐：偏好 5 条 ×240 字，执行 3 条 ×1000 字。
const PREF_MAX_ITEMS = 5;
const PREF_MAX_TEXT = 240;
const EXEC_MAX_ITEMS = 3;
const EXEC_MAX_TEXT = 1000;
export const AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS = 1000;

class AgentMemoryRetrievalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent memory retrieval timed out after ${timeoutMs}ms`);
    this.name = 'AgentMemoryRetrievalTimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new AgentMemoryRetrievalTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function truncate(text: string, limit: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
}

/**
 * 一次 mem0 检索，按 memoryScope 路由成「偏好 block」+「执行经验 block」。
 *
 * 替代原先偏好/执行各查一次的两次检索（同一句 query 查两遍），并修掉执行经验
 * 泄漏进偏好 block 的问题（原 normalizeMemorySearchResults 不按 scope 过滤）。
 *
 * 路由：
 *  - memoryScope==='execution'（且 active、confidence>=0.5）→ 执行经验 block（rich directCommand 格式）。
 *  - memoryScope!=='execution' → 偏好 block。
 *
 * 注：统一按 userId 检索，不传 agentId/runId。偏好与执行经验在同一用户的
 * 所有项目、Agent 和会话之间共享，再由相关性排序取 top。
 */
export async function buildAgentMemoryContextBlocks(
  text: string,
  options?: { topK?: number },
): Promise<AgentMemoryContextBlocks> {
  const query = text.replace(/\s+/g, ' ').trim();
  if (!shouldRetrieveMemories(query)) return { injectedExecutionMemories: [] };
  try {
    let retrievalTimedOut = false;
    const retrieval = (async () => {
      const userId = await resolveAgentMemoryUserId();
      if (!userId || retrievalTimedOut) return undefined;
      return await invokeIpc<unknown>(
        'agent-memory:mem0-search',
        query,
        { userId, topK: Math.max(options?.topK ?? 12, 12) },
      );
    })();
    const payload = await withTimeout(retrieval, AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS, () => {
      retrievalTimedOut = true;
    });
    if (payload === undefined) return { injectedExecutionMemories: [] };
    const execItems = extractActiveExecutionMemories(payload)
      .slice(0, EXEC_MAX_ITEMS)
      .map((it) => ({ ...it, memory: truncate(it.memory, EXEC_MAX_TEXT) }));
    const prefItems = extractPreferenceMemories(payload)
      .slice(0, PREF_MAX_ITEMS)
      .map((it) => ({ ...it, memory: truncate(it.memory, PREF_MAX_TEXT) }));
    return {
      preference: prefItems.length > 0 ? buildAgentMemoryContextText(prefItems) : undefined,
      execution: execItems.length > 0 ? buildAgentExecutionMemoryContextText(execItems) : undefined,
      injectedExecutionMemories: execItems
        .filter((item): item is typeof item & { id: string } => typeof item.id === 'string' && item.id.length > 0)
        .map((item) => ({ memoryId: item.id, memory: item.memory })),
    };
  } catch (error) {
    console.warn('[agent-memory] context blocks retrieval failed:', error);
    return { injectedExecutionMemories: [] };
  }
}
