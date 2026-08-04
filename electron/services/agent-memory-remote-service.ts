import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';
import { readOpenAiChatCompletionSse } from './openai-chat-completion-sse';

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
  createdAt?: string;
  updatedAt?: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  sessionId?: string;
  turnId?: string;
  source?: string;
  appId?: string;
  actorId?: string;
  role?: string;
  expirationDate?: string;
  attributedTo?: string;
  textLemmatized?: string;
  hash?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMemorySearchResultItem {
  recordId: string;
  score: number;
  content: string;
  hash?: string | null;
  memoryType?: string;
  source?: string;
  userId?: string | null;
  appId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  actorId?: string | null;
  role?: string | null;
  expirationDate?: string | null;
  attributedTo?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
const AGENT_MEMORY_KEYWORD_SEARCH_PATH = '/agent/v1/agent-memory/keyword/search';
const AGENT_MEMORY_VECTOR_GET_PATH = '/agent/v1/agent-memory/vector/get';
const AGENT_MEMORY_VECTOR_LIST_PATH = '/agent/v1/agent-memory/vector/list';
const AGENT_MEMORY_VECTOR_DELETE_PATH = '/agent/v1/agent-memory/vector/delete';
const AGENT_MEMORY_VECTOR_DELETE_COL_PATH = '/agent/v1/agent-memory/vector/delete-col';
const AGENT_MEMORY_CHAT_COMPLETIONS_PATH = '/agent/v1/chat/completions';
const AGENT_MEMORY_MODELS_PATH = '/agent/v1/models';
const AGENT_MEMORY_TOP_K_MAX = 20;
const AGENT_MEMORY_TOP_K_DEFAULT = 8;
const AGENT_MEMORY_KEYWORD_TOP_K_MAX = 200;
const AGENT_MEMORY_KEYWORD_TOP_K_DEFAULT = 60;
const CHAT_STREAM_HEADER_TIMEOUT_MS = 90_000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const CHAT_STREAM_TOTAL_TIMEOUT_MS = 300_000;
const STREAM_UNSUPPORTED_STATUSES = new Set([400, 404, 405, 415, 422, 501]);

function extractChatCompletionText(response: Record<string, unknown>): string {
  const firstChoice = Array.isArray(response.choices)
    ? response.choices[0] as Record<string, unknown> | undefined
    : undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  return typeof message?.content === 'string' ? message.content : '';
}

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
  // logger.info('[mem0][remote] request success', {
  //   path,
  //   method: init?.method || 'GET',
  //   status: response.status,
  //   traceId: body.traceId,
  // });
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
    logger.info('[mem0][remote] embedder start', { input, model});
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

  async searchKeywords(params: {
    query: string;
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
    const requestedTopK = Number.isFinite(params.topK)
      ? Math.trunc(params.topK as number)
      : AGENT_MEMORY_KEYWORD_TOP_K_DEFAULT;
    const topK = Math.min(Math.max(requestedTopK, 1), AGENT_MEMORY_KEYWORD_TOP_K_MAX);
    logger.info('[mem0][remote] searchKeywords', {
      queryLength: params.query.length,
      collectionName: params.collectionName,
      topK,
      memoryTypes: params.memoryTypes,
    });
    return await requestMemoryCenter<{
      items: AgentMemorySearchResultItem[];
      topK: number;
      count: number;
    }>(AGENT_MEMORY_KEYWORD_SEARCH_PATH, {
      method: 'POST',
      body: JSON.stringify({ ...params, topK }),
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

  async getVectors(recordIds: string[], collectionName?: string): Promise<{
    items: AgentMemorySearchResultItem[];
    count: number;
  }> {
    logger.info('[mem0][remote] getVectors', {
      count: recordIds.length,
      collectionName,
    });
    return await requestMemoryCenter<{
      items: AgentMemorySearchResultItem[];
      count: number;
    }>(AGENT_MEMORY_VECTOR_GET_PATH, {
      method: 'POST',
      body: JSON.stringify({ recordIds, collectionName }),
    });
  }

  async listVectors(params: {
    collectionName?: string;
    topK?: number;
    agentId?: string;
    runId?: string;
    sessionId?: string;
    memoryTypes?: string[];
  }): Promise<{
    items: AgentMemorySearchResultItem[];
    count: number;
    total: number;
    topK: number;
  }> {
    const topK = Math.min(Math.max(Math.trunc(params.topK ?? 100), 1), 100);
    logger.info('[mem0][remote] listVectors', {
      collectionName: params.collectionName,
      topK,
      agentId: params.agentId,
      runId: params.runId,
      sessionId: params.sessionId,
      memoryTypes: params.memoryTypes,
    });
    return await requestMemoryCenter<{
      items: AgentMemorySearchResultItem[];
      count: number;
      total: number;
      topK: number;
    }>(AGENT_MEMORY_VECTOR_LIST_PATH, {
      method: 'POST',
      body: JSON.stringify({ ...params, topK }),
    });
  }

  async deleteVectorCollection(collectionName?: string): Promise<{ deleted: number }> {
    logger.info('[mem0][remote] deleteVectorCollection', { collectionName });
    return await requestMemoryCenter<{ deleted: number }>(AGENT_MEMORY_VECTOR_DELETE_COL_PATH, {
      method: 'POST',
      body: JSON.stringify({ collectionName }),
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
      timeoutMs: 120_000,
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

  async createChatCompletionStream(payload: Record<string, unknown>): Promise<string> {
    const baseUrl = await resolveStoBaseUrl();
    const controller = new AbortController();
    const startedAt = Date.now();
    let totalTimedOut = false;
    const totalTimer = setTimeout(() => {
      totalTimedOut = true;
      controller.abort();
    }, CHAT_STREAM_TOTAL_TIMEOUT_MS);
    const streamOptions = payload.stream_options && typeof payload.stream_options === 'object'
      ? payload.stream_options as Record<string, unknown>
      : {};
    const streamPayload = {
      ...payload,
      stream: true,
      stream_options: { ...streamOptions, include_usage: true },
    };

    logger.info('[mem0][remote] createChatCompletionStream start', {
      model: payload.model,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      payloadLength: JSON.stringify(streamPayload).length,
      headerTimeoutMs: CHAT_STREAM_HEADER_TIMEOUT_MS,
      idleTimeoutMs: CHAT_STREAM_IDLE_TIMEOUT_MS,
      totalTimeoutMs: CHAT_STREAM_TOTAL_TIMEOUT_MS,
    });

    try {
      const response = await proxyAwareFetch(`${baseUrl}${AGENT_MEMORY_CHAT_COMPLETIONS_PATH}`, {
        method: 'POST',
        timeoutMs: CHAT_STREAM_HEADER_TIMEOUT_MS,
        signal: controller.signal,
        headers: await getAuthHeaders(),
        body: JSON.stringify(streamPayload),
      });

      const contentType = response.headers.get('content-type') ?? '';
      logger.info('[mem0][remote] createChatCompletionStream headers', {
        status: response.status,
        contentType,
        elapsedMs: Date.now() - startedAt,
      });
      if (!response.ok) {
        const errorBody = await response.text();
        if (STREAM_UNSUPPORTED_STATUSES.has(response.status)) {
          logger.warn('[mem0][remote] chat stream unsupported, falling back', {
            status: response.status,
          });
          const fallbackPayload = { ...payload };
          delete fallbackPayload.stream;
          delete fallbackPayload.stream_options;
          return extractChatCompletionText(await this.createChatCompletion(fallbackPayload));
        }
        let detail = errorBody;
        try {
          const parsed = JSON.parse(errorBody) as { detail?: unknown };
          detail = String(parsed.detail ?? errorBody);
        } catch {
          // Keep the original response text.
        }
        throw new Error(detail || `Chat completion stream failed: ${response.status}`);
      }

      if (!contentType.toLowerCase().includes('text/event-stream')) {
        const body = await response.json() as Record<string, unknown>;
        logger.warn('[mem0][remote] chat stream returned non-SSE response', { contentType });
        return extractChatCompletionText(body);
      }
      if (!response.body) throw new Error('模型流式响应缺少响应体');

      const elapsedMs = Date.now() - startedAt;
      const assistantText = await readOpenAiChatCompletionSse(response.body, {
        idleTimeoutMs: CHAT_STREAM_IDLE_TIMEOUT_MS,
        totalTimeoutMs: Math.max(1, CHAT_STREAM_TOTAL_TIMEOUT_MS - elapsedMs),
        onTimeout: () => controller.abort(),
        // onChunk: (progress) => logger.debug('[mem0][remote] chat stream chunk', progress),
        // onEvent: (progress) => logger.debug(
        //   progress.done
        //     ? '[mem0][remote] chat stream done'
        //     : '[mem0][remote] chat stream event',
        //   progress,
        // ),
      });
      logger.info('[mem0][remote] createChatCompletionStream success', {
        status: response.status,
        assistantTextLength: assistantText.length,
        elapsedMs: Date.now() - startedAt,
      });
      return assistantText;
    } catch (error) {
      logger.warn('[mem0][remote] createChatCompletionStream failed', {
        elapsedMs: Date.now() - startedAt,
        totalTimedOut,
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      });
      if (totalTimedOut) {
        throw new Error(
          `模型流式请求总时长超过 ${Math.round(CHAT_STREAM_TOTAL_TIMEOUT_MS / 1000)} 秒`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(totalTimer);
    }
  }
}

export const agentMemoryRemoteService = new AgentMemoryRemoteService();
