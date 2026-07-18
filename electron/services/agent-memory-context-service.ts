import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import {
  buildAgentMemoryContextBlocks,
  shouldRetrieveAgentMemories,
  type AgentMemoryContextBlocks,
} from '../../shared/agent-memory-prompt';

export const AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS = 5000;
export const AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS = 3000;

class AgentMemoryTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Agent memory ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'AgentMemoryTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new AgentMemoryTimeoutError(operation, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export class AgentMemoryContextService {
  private initializationPromise: ReturnType<typeof agentMemoryOrchestrator.initialize> | null = null;

  warmup(): void {
    void this.initializeOnce().catch((error) => {
      console.warn('[agent-memory] main context warmup failed:', error);
    });
  }

  async prepare(sourceText: string): Promise<AgentMemoryContextBlocks> {
    const query = sourceText.replace(/\s+/g, ' ').trim();
    if (!shouldRetrieveAgentMemories(query)) return { injectedExecutionMemories: [] };

    try {
      const initialized = await withTimeout(
        this.initializeOnce(),
        'initialization',
        AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS,
      );
      const bootstrap = initialized?.bootstrap;
      const userId = bootstrap?.enabled === true && typeof bootstrap.userId === 'string'
        ? bootstrap.userId.trim()
        : '';
      if (!userId) return { injectedExecutionMemories: [] };

      const payload = await withTimeout(
        agentMemoryOrchestrator.searchMemories(query, { userId, topK: 12 }),
        'retrieval',
        AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS,
      );
      return buildAgentMemoryContextBlocks(payload);
    } catch (error) {
      console.warn('[agent-memory] main context retrieval failed:', error);
      return { injectedExecutionMemories: [] };
    }
  }

  private initializeOnce(): ReturnType<typeof agentMemoryOrchestrator.initialize> {
    if (this.initializationPromise) return this.initializationPromise;

    const initializationPromise = agentMemoryOrchestrator.initialize();
    const cachedPromise = initializationPromise.catch((error) => {
      if (this.initializationPromise === cachedPromise) this.initializationPromise = null;
      throw error;
    });
    this.initializationPromise = cachedPromise;
    return cachedPromise;
  }
}

export const agentMemoryContextService = new AgentMemoryContextService();
