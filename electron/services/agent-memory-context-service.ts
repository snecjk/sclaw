import { agentMemoryOrchestrator } from './agent-memory-orchestrator';
import { logger } from '../utils/logger';
import {
  buildAgentMemoryContextBlocks,
  shouldRetrieveAgentMemories,
  type AgentMemoryContextBlocks,
} from '../../shared/agent-memory-prompt';

export const AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS = 5000;
export const AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS = 3000;
export const AGENT_MEMORY_WARMUP_MAX_ATTEMPTS = 3;
const AGENT_MEMORY_WARMUP_RETRY_BASE_DELAY_MS = 500;

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

type WarmupRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

export async function initializeAgentMemoryWithRetry(
  initialize: () => ReturnType<typeof agentMemoryOrchestrator.initialize>,
  options: WarmupRetryOptions = {},
): ReturnType<typeof agentMemoryOrchestrator.initialize> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? AGENT_MEMORY_WARMUP_MAX_ATTEMPTS));
  const baseDelayMs = Math.max(0, Math.trunc(options.baseDelayMs ?? AGENT_MEMORY_WARMUP_RETRY_BASE_DELAY_MS));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await initialize();
    } catch (error) {
      const exhausted = attempt === maxAttempts;
      const retryInMs = exhausted ? 0 : baseDelayMs * attempt;
      logger.warn('[agent-memory] startup warmup failed', {
        attempt,
        maxAttempts,
        retryInMs,
        error: error instanceof Error ? error.message : String(error),
      });
      if (exhausted) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryInMs));
    }
  }

  throw new Error('Agent Memory startup warmup retry loop exhausted');
}

function getPayloadItemCount(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) return record.results.length;
  if (Array.isArray(record.items)) return record.items.length;
  return typeof record.count === 'number' ? record.count : null;
}

export class AgentMemoryContextService {
  private initializationPromise: ReturnType<typeof agentMemoryOrchestrator.initialize> | null = null;
  private initializationInFlight = false;
  private loginReinitializationPromise: ReturnType<typeof agentMemoryOrchestrator.initialize> | null = null;

  warmup(): void {
    void this.initializeOnce(() => initializeAgentMemoryWithRetry(
      () => agentMemoryOrchestrator.initialize(),
    )).catch((error) => {
      logger.warn('[agent-memory] main context warmup failed:', error);
    });
  }

  reinitializeAfterLogin(): ReturnType<typeof agentMemoryOrchestrator.initialize> {
    if (this.loginReinitializationPromise) return this.loginReinitializationPromise;

    const task = this.performLoginReinitialization();
    const tracked = task.finally(() => {
      if (this.loginReinitializationPromise === tracked) {
        this.loginReinitializationPromise = null;
      }
    });
    this.loginReinitializationPromise = tracked;
    return tracked;
  }

  async prepare(sourceText: string): Promise<AgentMemoryContextBlocks> {
    const query = sourceText.replace(/\s+/g, ' ').trim();
    const shouldRetrieve = shouldRetrieveAgentMemories(query);
    logger.info('[agent-memory] main context prepare', {
      queryLength: query.length,
      queryPreview: query.slice(0, 120),
      shouldRetrieve,
    });
    if (!shouldRetrieve) {
      logger.info('[agent-memory] main context skipped', {
        reason: query ? 'below_retrieval_threshold' : 'empty_query',
        queryLength: query.length,
      });
      return { injectedExecutionMemories: [] };
    }

    try {
      const initialized = await withTimeout(
        this.initializeOnce(),
        'initialization',
        AGENT_MEMORY_INITIALIZATION_TIMEOUT_MS,
      );
      const bootstrap = initialized?.bootstrap;
      logger.info('[agent-memory] main context initialized', {
        ready: initialized?.ready === true,
        enabled: bootstrap?.enabled,
        userId: bootstrap?.userId,
        sdkAvailable: initialized?.sdkAvailable,
      });
      const userId = bootstrap?.enabled === true && typeof bootstrap.userId === 'string'
        ? bootstrap.userId.trim()
        : '';
      if (!userId) {
        logger.info('[agent-memory] main context skipped', {
          reason: bootstrap?.enabled === true ? 'missing_user_id' : 'memory_disabled',
          enabled: bootstrap?.enabled,
        });
        return { injectedExecutionMemories: [] };
      }

      logger.info('[agent-memory] main context search start', {
        queryLength: query.length,
        userId,
        topK: 12,
      });
      const payload = await withTimeout(
        agentMemoryOrchestrator.searchMemories(query, { userId, topK: 12 }),
        'retrieval',
        AGENT_MEMORY_RETRIEVAL_TIMEOUT_MS,
      );
      logger.info('[agent-memory] main context search returned', {
        rawResultCount: getPayloadItemCount(payload),
        payloadShape: Array.isArray(payload)
          ? 'array'
          : payload && typeof payload === 'object'
            ? Object.keys(payload as Record<string, unknown>)
            : typeof payload,
      });
      const context = buildAgentMemoryContextBlocks(payload);
      logger.info('[agent-memory] main context built', {
        hasPreference: Boolean(context.preference),
        preferenceLength: context.preference?.length ?? 0,
        hasExecution: Boolean(context.execution),
        executionLength: context.execution?.length ?? 0,
        injectedExecutionCount: context.injectedExecutionMemories.length,
        injectedExecutionMemoryIds: context.injectedExecutionMemories.map((item) => item.memoryId),
      });
      return context;
    } catch (error) {
      logger.warn('[agent-memory] main context retrieval failed:', error);
      return { injectedExecutionMemories: [] };
    }
  }

  private initializeOnce(
    initialize: () => ReturnType<typeof agentMemoryOrchestrator.initialize> = () => agentMemoryOrchestrator.initialize(),
  ): ReturnType<typeof agentMemoryOrchestrator.initialize> {
    if (this.initializationPromise) return this.initializationPromise;

    const initializationPromise = initialize();
    this.initializationInFlight = true;
    const cachedPromise = initializationPromise.then(
      (status) => {
        if (this.initializationPromise === cachedPromise) this.initializationInFlight = false;
        return status;
      },
      (error) => {
        if (this.initializationPromise === cachedPromise) {
          this.initializationPromise = null;
          this.initializationInFlight = false;
        }
        throw error;
      },
    );
    this.initializationPromise = cachedPromise;
    return cachedPromise;
  }

  private async performLoginReinitialization(): ReturnType<typeof agentMemoryOrchestrator.initialize> {
    const activeInitialization = this.initializationInFlight ? this.initializationPromise : null;
    if (activeInitialization) {
      try {
        const status = await activeInitialization;
        if (status.bootstrap?.enabled === true && status.bootstrap.userId?.trim()) {
          logger.info('[agent-memory] login reinitialize reused active startup initialization', {
            userId: status.bootstrap.userId,
          });
          return status;
        }
      } catch {
        // The failed startup promise clears itself; continue with authenticated initialization.
      }
    }

    this.initializationPromise = null;
    this.initializationInFlight = false;
    logger.info('[agent-memory] login reinitialize start');
    return await this.initializeOnce(() => agentMemoryOrchestrator.reinitializeAfterAuthChange());
  }
}

export const agentMemoryContextService = new AgentMemoryContextService();
