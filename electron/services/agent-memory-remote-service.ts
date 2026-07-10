import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';

export interface AgentMemoryBootstrap {
  enabled: boolean;
  appId: string;
  userId: string;
  features?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  embedder?: Record<string, unknown>;
  llm?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  traceId?: string;
}

export interface AgentMemoryIndexRecordInput {
  recordId: string;
  vector: number[];
  content: string;
  collectionName?: string;
  memoryType?: string;
  occurredAt?: string;
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  source?: string;
  appId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMemorySearchResultItem {
  recordId: string;
  score: number;
  content: string;
  memoryType?: string;
  source?: string;
  agentId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
}

type MemoryCenterEnvelope<T> = {
  success?: boolean;
  errMessage?: string;
  data?: T;
  traceId?: string;
};

const AGENT_MEMORY_BOOTSTRAP_PATH = '/agent/v1/agent-memory/bootstrap';
const AGENT_MEMORY_EMBEDDER_CREATE_PATH = '/agent/v1/agent-memory/embedder/create';
const AGENT_MEMORY_VECTOR_UPSERT_PATH = '/agent/v1/agent-memory/vector/upsert';
const AGENT_MEMORY_VECTOR_SEARCH_PATH = '/agent/v1/agent-memory/vector/search';
const AGENT_MEMORY_VECTOR_DELETE_PATH = '/agent/v1/agent-memory/vector/delete';
const AGENT_MEMORY_CHAT_COMPLETIONS_PATH = '/agent/v1/chat/completions';
const AGENT_MEMORY_MODELS_PATH = '/agent/v1/models';
const AGENT_MEMORY_TOP_K_MAX = 20;
const AGENT_MEMORY_TOP_K_DEFAULT = 8;

function clampTopK(topK?: number): number {
  if (!Number.isFinite(topK)) {
    return AGENT_MEMORY_TOP_K_DEFAULT;
  }
  return Math.min(Math.max(Math.trunc(topK as number), 1), AGENT_MEMORY_TOP_K_MAX);
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoToken();
  if (!token) {
    throw new Error('Sto token is missing');
  }
  return {
    'Content-Type': 'application/json',
    ...buildStoMemoryCenterAuthHeaders(token),
  };
}

async function requestMemoryCenter<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const baseUrl = await resolveStoBaseUrl();
  logger.info('[mem0][remote] request start', {
    path,
    method: init?.method || 'GET',
    timeoutMs: init?.timeoutMs ?? 15_000,
  });
  const response = await proxyAwareFetch(`${baseUrl}${path}`, {
    timeoutMs: 15_000,
    ...init,
    headers: {
      ...(await getAuthHeaders()),
      ...(init?.headers ?? {}),
    },
  });

  const body = await response.json() as MemoryCenterEnvelope<T>;
  if (!response.ok || body.success === false) {
    logger.error('[mem0][remote] request failed', {
      path,
      method: init?.method || 'GET',
      status: response.status,
      errMessage: body.errMessage,
      traceId: body.traceId,
    });
    throw new Error(body.errMessage || `Memory center request failed: ${response.status}`);
  }
  logger.info('[mem0][remote] request success', {
    path,
    method: init?.method || 'GET',
    status: response.status,
    traceId: body.traceId,
  });
  return body.data as T;
}

export class AgentMemoryRemoteService {
  async getBootstrap(): Promise<AgentMemoryBootstrap> {
    return await requestMemoryCenter<AgentMemoryBootstrap>(AGENT_MEMORY_BOOTSTRAP_PATH, {
      method: 'GET',
    });
  }

  async createEmbeddings(input: string | string[], model?: string): Promise<{
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    usage?: Record<string, unknown>;
  }> {
    return await requestMemoryCenter<{
      embeddings: Array<{ index: number; embedding: number[] }>;
      model: string;
      usage?: Record<string, unknown>;
    }>(AGENT_MEMORY_EMBEDDER_CREATE_PATH, {
      method: 'POST',
      body: JSON.stringify({ input, model }),
    });
  }

  async upsertVectors(records: AgentMemoryIndexRecordInput[]): Promise<{
    accepted: number;
    embedded: number;
    failed: number;
  }> {
    logger.info('[mem0][remote] upsertVectors', {
      count: records.length,
      collectionName: records[0]?.collectionName,
    });
    return await requestMemoryCenter<{
      accepted: number;
      embedded: number;
      failed: number;
    }>(AGENT_MEMORY_VECTOR_UPSERT_PATH, {
      method: 'POST',
      body: JSON.stringify({
        collectionName: records[0]?.collectionName,
        records,
      }),
    });
  }

  async searchVectors(params: {
    vector: number[];
    topK?: number;
    collectionName?: string;
    agentId?: string;
    runId?: string;
    sessionId?: string;
    memoryTypes?: string[];
  }): Promise<{
    items: AgentMemorySearchResultItem[];
    topK: number;
    count: number;
  }> {
    const clampedTopK = clampTopK(params.topK);
    if (clampedTopK !== params.topK) {
      logger.warn('[mem0][remote] searchVectors clamp topK', {
        requestedTopK: params.topK,
        clampedTopK,
      });
    }
    logger.info('[mem0][remote] searchVectors', {
      collectionName: params.collectionName,
      topK: clampedTopK,
      dimension: params.vector.length,
      agentId: params.agentId,
      runId: params.runId,
      sessionId: params.sessionId,
      memoryTypes: params.memoryTypes,
    });
    return await requestMemoryCenter<{
      items: AgentMemorySearchResultItem[];
      topK: number;
      count: number;
    }>(AGENT_MEMORY_VECTOR_SEARCH_PATH, {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        topK: clampedTopK,
      }),
    });
  }

  async deleteVectors(recordIds: string[], collectionName?: string): Promise<{ deleted: number }> {
    logger.info('[mem0][remote] deleteVectors', {
      count: recordIds.length,
      collectionName,
    });
    return await requestMemoryCenter<{ deleted: number }>(AGENT_MEMORY_VECTOR_DELETE_PATH, {
      method: 'POST',
      body: JSON.stringify({ recordIds, collectionName }),
    });
  }

  async listModels(): Promise<{ object?: string; data?: Array<Record<string, unknown>> }> {
    const baseUrl = await resolveStoBaseUrl();
    logger.info('[mem0][remote] listModels start');
    const response = await proxyAwareFetch(`${baseUrl}${AGENT_MEMORY_MODELS_PATH}`, {
      method: 'GET',
      timeoutMs: 15_000,
      headers: await getAuthHeaders(),
    });
    if (!response.ok) {
      logger.error('[mem0][remote] listModels failed', { status: response.status });
      throw new Error(`List models failed: ${response.status}`);
    }
    const body = await response.json() as { object?: string; data?: Array<Record<string, unknown>> };
    logger.info('[mem0][remote] listModels success', {
      count: Array.isArray(body.data) ? body.data.length : 0,
    });
    return body;
  }

  async createChatCompletion(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const baseUrl = await resolveStoBaseUrl();
    logger.info('[mem0][remote] createChatCompletion start', {
      model: payload.model,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    });
    const response = await proxyAwareFetch(`${baseUrl}${AGENT_MEMORY_CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      timeoutMs: 60_000,
      headers: await getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      logger.error('[mem0][remote] createChatCompletion failed', {
        status: response.status,
        detail: (body as { detail?: unknown }).detail,
      });
      throw new Error(String((body as { detail?: unknown }).detail ?? `Chat completion failed: ${response.status}`));
    }
    logger.info('[mem0][remote] createChatCompletion success', {
      status: response.status,
      choiceCount: Array.isArray(body.choices) ? body.choices.length : 0,
    });
    return body;
  }
}

export const agentMemoryRemoteService = new AgentMemoryRemoteService();
