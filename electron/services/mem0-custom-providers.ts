import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  EmbeddingConfig,
  LLM,
  LLMConfig,
  LLMResponse,
  Message,
  SearchFilters,
  VectorStore,
  VectorStoreConfig,
  VectorStoreResult,
} from 'mem0ai/oss';

import {
  agentMemoryRemoteService,
  type AgentMemorySearchResultItem,
} from './agent-memory-remote-service';
import { logger } from '../utils/logger';

const MEM0_CUSTOM_LLM_PROVIDER = 'sto_memory_center_llm';
const MEM0_CUSTOM_EMBEDDER_PROVIDER = 'sto_memory_center_embedder';
const MEM0_CUSTOM_VECTOR_PROVIDER = 'sto_memory_center_vector';
const STO_CLAW_MEMORY_CUSTOM_INSTRUCTIONS = `
你是 sto-claw 的长期记忆抽取器。只抽取稳定、可长期复用的用户记忆。

只允许记录：
- 用户明确要求“记住”的内容。
- 用户对回答风格、语言、输出格式、工具、工作流、默认行为的偏好。
- 用户稳定的身份、角色、职责、团队背景或工作上下文。
- 用户的长期目标、持续关注事项或长期约束。
- 用户对助手行为的纠错，并且这个纠错应影响后续回答。

必须忽略：
- 一次性业务查询。
- 天气、新闻、行情、运营报表、临时统计、具体业务数值。
- 工具执行结果、原始表格、日志、报错堆栈、临时分析结论。
- “用户问过某个问题”这件事本身。
- 仅由助手得出的结论，除非用户明确确认需要长期记住。
- 任何只在当前会话中有用、时效性强、不确定或可能过期的信息。

抽取要求：
- 记忆必须简洁、明确、可长期复用。
- 尽量使用用户原始语言；中文用户的记忆用中文表达。
- 如果没有值得长期记忆的内容，返回空事实列表。

示例：
输入：记住我喜欢简洁回答
输出：{"facts":["用户偏好：喜欢简洁回答。"]}

输入：查一下 2026-07-09 全国揽收量
输出：{"facts":[]}

输入：以后查数据优先用 CLI
输出：{"facts":["用户偏好：查询数据时优先使用 CLI 工具。"]}

输入：今天全国揽收量是 81,036,103
输出：{"facts":[]}
`.trim();

type OssModuleShape = {
  EmbedderFactory: { create: (provider: string, config: EmbeddingConfig) => unknown };
  LLMFactory: { create: (provider: string, config: LLMConfig) => LLM };
  VectorStoreFactory: { create: (provider: string, config: VectorStoreConfig) => VectorStore };
};

type CachedVectorRecord = {
  id: string;
  payload: Record<string, unknown>;
};

type CachedVectorStoreFile = {
  userId?: string;
  records: Record<string, CachedVectorRecord>;
};

type Mem0CustomVectorConfig = VectorStoreConfig & {
  cacheDir: string;
  userIdFilePath?: string;
};

function normalizeRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'system' || role === 'assistant') {
    return role;
  }
  return 'user';
}

function normalizeMessageContent(content: string | { type: string; image_url?: { url: string } }): string {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content);
}

class StoMemoryCenterLlmProvider implements LLM {
  private readonly configuredModel?: string;
  private resolvedModel: string | null = null;

  constructor(config: LLMConfig) {
    this.configuredModel = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : undefined;
  }

  private async resolveModel(): Promise<string> {
    if (this.resolvedModel) {
      return this.resolvedModel;
    }
    if (this.configuredModel) {
      this.resolvedModel = this.configuredModel;
      return this.resolvedModel;
    }
    const result = await agentMemoryRemoteService.listModels();
    const firstModelId = result.data?.find((item) => typeof item.id === 'string' && item.id.trim())?.id;
    this.resolvedModel = typeof firstModelId === 'string' && firstModelId.trim() ? firstModelId : 'qwen3.6-plus';
    return this.resolvedModel;
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    responseFormat?: { type: string },
    tools?: any[],
  ): Promise<string | LLMResponse> {
    const model = await this.resolveModel();
    logger.info('[mem0][llm] generateResponse start', {
      model,
      messageCount: messages.length,
      hasResponseFormat: Boolean(responseFormat),
      toolCount: Array.isArray(tools) ? tools.length : 0,
    });
    const response = await agentMemoryRemoteService.createChatCompletion({
      model,
      messages,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    });
    const firstChoice = Array.isArray(response.choices) ? response.choices[0] as Record<string, any> | undefined : undefined;
    const message = (firstChoice?.message ?? {}) as Record<string, any>;
    const content = typeof message.content === 'string' ? message.content : '';
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      logger.info('[mem0][llm] generateResponse tool-calls', {
        model,
        toolCallCount: message.tool_calls.length,
      });
      return {
        content,
        role: typeof message.role === 'string' ? message.role : 'assistant',
        toolCalls: message.tool_calls.map((call: Record<string, any>) => ({
          name: String(call.function?.name ?? ''),
          arguments: String(call.function?.arguments ?? ''),
        })),
      };
    }
    logger.info('[mem0][llm] generateResponse success', {
      model,
      contentLength: content.length,
    });
    return content;
  }

  async generateChat(messages: Message[]): Promise<LLMResponse> {
    const model = await this.resolveModel();
    logger.info('[mem0][llm] generateChat start', {
      model,
      messageCount: messages.length,
    });
    const response = await agentMemoryRemoteService.createChatCompletion({
      model,
      messages: messages.map((message) => ({
        role: normalizeRole(message.role),
        content: normalizeMessageContent(message.content),
      })),
    });
    const firstChoice = Array.isArray(response.choices) ? response.choices[0] as Record<string, any> | undefined : undefined;
    const message = (firstChoice?.message ?? {}) as Record<string, any>;
    return {
      content: typeof message.content === 'string' ? message.content : '',
      role: typeof message.role === 'string' ? message.role : 'assistant',
    };
  }
}

class StoMemoryCenterEmbedderProvider {
  async embed(text: string): Promise<number[]> {
    const result = await agentMemoryRemoteService.createEmbeddings(text);
    const embedding = result.embeddings[0]?.embedding ?? [];
    logger.info('[mem0][embedder] embed success', { dimension: embedding.length });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const result = await agentMemoryRemoteService.createEmbeddings(texts);
    const embeddings = result.embeddings
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
    logger.info('[mem0][embedder] embedBatch success', {
      batchSize: texts.length,
      embeddingCount: embeddings.length,
      firstDimension: embeddings[0]?.length ?? 0,
    });
    return embeddings;
  }
}

class StoMemoryCenterVectorStoreProvider implements VectorStore {
  private readonly collectionName: string;
  private readonly cacheDir: string;
  private readonly cacheFilePath: string;
  private readonly userIdFilePath?: string;
  private userId: string | null = null;

  constructor(config: Mem0CustomVectorConfig) {
    // mem0 only configures the primary vector store collection explicitly
    // (`memories`). When infer/entity linking is enabled, mem0 internally
    // creates a second vector store with `${collectionName}_entities`
    // (for example `memories_entities`) and instantiates this provider again
    // with that derived collectionName. So this provider must treat
    // collectionName as runtime input instead of assuming a single store.
    this.collectionName = config.collectionName || 'memories';
    this.cacheDir = config.cacheDir;
    this.cacheFilePath = join(this.cacheDir, `${this.collectionName}.json`);
    this.userIdFilePath = config.userIdFilePath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const cache = await this.readCache();
    if (cache.userId) {
      this.userId = cache.userId;
    }
    logger.info('[mem0][vector] initialize', {
      collectionName: this.collectionName,
      cacheFilePath: this.cacheFilePath,
      hasUserId: Boolean(this.userId),
      recordCount: Object.keys(cache.records).length,
    });
  }

  async insert(vectors: number[][], ids: string[], payloads: Record<string, any>[]): Promise<void> {
    logger.info('[mem0][vector] insert start', {
      count: ids.length,
      vectorDimension: vectors[0]?.length ?? 0,
      memoryScopes: payloads.map((p) => p?.memoryScope).filter(Boolean),
    });
    const records = ids.map((id, index) => {
      const payload = this.normalizePayload(payloads[index] || {});
      return {
        recordId: id,
        collectionName: this.collectionName,
        vector: vectors[index] || [],
        content: String(payload.data ?? ''),
        // mem0 SDK 不设 memory_type（payloads 里无该字段），默认 'memory'。
        // 用 metadata.memoryScope 把记忆类型显式标到可服务端检索的 memory_type 字段：
        //   memoryScope='execution' → 'execution'，'preference' → 'preference'，无则 'memory'。
        // 使 memoryTypes 过滤可区分"执行经验/普通偏好"两类，不必 fetch 全部再后过滤。
        memoryType: payload.memoryScope ? String(payload.memoryScope) : String(payload.memory_type ?? 'memory'),
        userId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
        appId: typeof payload.app_id === 'string' ? payload.app_id : undefined,
        agentId: typeof payload.agent_id === 'string' ? payload.agent_id : undefined,
        runId: typeof payload.run_id === 'string' ? payload.run_id : undefined,
        sessionId: this.readString(payload, 'session_id', 'sessionId', 'sessionKey'),
        turnId: this.readString(payload, 'turn_id', 'turnId'),
        occurredAt: this.readString(payload, 'occurred_at', 'occurredAt'),
        createdAt: this.readString(payload, 'created_at', 'createdAt'),
        updatedAt: this.readString(payload, 'updated_at', 'updatedAt'),
        source: this.readString(payload, 'source') ?? 'mem0',
        actorId: this.readString(payload, 'actor_id', 'actorId'),
        role: this.readString(payload, 'role'),
        expirationDate: this.readString(payload, 'expiration_date', 'expirationDate'),
        attributedTo: this.readString(payload, 'attributed_to', 'attributedTo'),
        hash: this.readString(payload, 'hash'),
        metadata: this.compactMetadata(payload),
      };
    });
    await agentMemoryRemoteService.upsertVectors(records);
    await this.upsertCache(ids, payloads);
    logger.info('[mem0][vector] insert success', { count: ids.length });
  }

  async search(query: number[], topK = 5, filters?: SearchFilters): Promise<VectorStoreResult[]> {
    logger.info('[mem0][vector] search start', {
      dimension: query.length,
      requestedTopK: topK,
      filters,
    });
    const response = await agentMemoryRemoteService.searchVectors({
      collectionName: this.collectionName,
      vector: query,
      topK,
      agentId: typeof filters?.agent_id === 'string' ? filters.agent_id : undefined,
      runId: typeof filters?.run_id === 'string' ? filters.run_id : undefined,
    });
    const cache = await this.readCache();
    const results = response.items.map((item) => {
      const cachedPayload = cache.records[item.recordId]?.payload;
      const payload = this.normalizePayload(
        // 兼容迁移前远端记录；新记录由紧凑字段恢复成 mem0 payload。
        (item.metadata?.payload && typeof item.metadata.payload === 'object' ? item.metadata.payload as Record<string, unknown> : null)
        ?? cachedPayload
        ?? this.rehydratePayload(item),
      );
      return {
        id: item.recordId,
        payload,
        score: item.score,
      };
    });
    logger.info('[mem0][vector] search success', {
      topK,
      count: results.length,
    });
    return results;
  }

  async keywordSearch(): Promise<VectorStoreResult[] | null> {
    // TODO 待接入
    return null;
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    try {
      const response = await agentMemoryRemoteService.getVectors([vectorId], this.collectionName);
      const item = response.items[0];
      if (!item) {
        logger.info('[mem0][vector] get remote miss', { vectorId });
        return null;
      }
      const cache = await this.readCache();
      const payload = this.payloadFromRemote(item, cache.records[vectorId]?.payload);
      cache.records[vectorId] = { id: vectorId, payload };
      await this.writeCache(cache);
      logger.info('[mem0][vector] get remote hit', { vectorId });
      return { id: vectorId, payload };
    } catch (error) {
      logger.warn('[mem0][vector] get remote failed, falling back to cache', {
        vectorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const cache = await this.readCache();
    const record = cache.records[vectorId];
    if (!record) {
      return null;
    }
    return {
      id: record.id,
      payload: this.normalizePayload(record.payload),
    };
  }

  async update(vectorId: string, vector: number[], payload: Record<string, any>): Promise<void> {
    logger.info('[mem0][vector] update start', { vectorId, dimension: vector.length });
    await this.insert([vector], [vectorId], [payload]);
  }

  async delete(vectorId: string): Promise<void> {
    logger.info('[mem0][vector] delete start', { vectorId });
    await agentMemoryRemoteService.deleteVectors([vectorId], this.collectionName);
    const cache = await this.readCache();
    delete cache.records[vectorId];
    await this.writeCache(cache);
    logger.info('[mem0][vector] delete success', { vectorId });
  }

  async deleteCol(): Promise<void> {
    const cache = await this.readCache();
    logger.info('[mem0][vector] deleteCol start', { collectionName: this.collectionName });
    const result = await agentMemoryRemoteService.deleteVectorCollection(this.collectionName);
    await this.writeCache({ userId: cache.userId, records: {} });
    try {
      await rm(this.cacheFilePath, { force: true });
    } catch {
      // ignore cleanup failures
    }
    logger.info('[mem0][vector] deleteCol success', { count: result.deleted });
  }

  async list(filters?: SearchFilters, topK = 100): Promise<[VectorStoreResult[], number]> {
    try {
      const response = await agentMemoryRemoteService.listVectors({
        collectionName: this.collectionName,
        // 拉取服务端允许的最大窗口后再应用 mem0 的扩展 payload filter。
        // 服务端结构化字段会先过滤，减少无关记录。
        topK: 100,
        agentId: this.readFilterString(filters, 'agent_id', 'agentId'),
        runId: this.readFilterString(filters, 'run_id', 'runId'),
        sessionId: this.readFilterString(filters, 'session_id', 'sessionId', 'sessionKey'),
        memoryTypes: this.readMemoryTypeFilters(filters),
      });
      const cache = await this.readCache();
      const all = response.items.map((item) => {
        const payload = this.payloadFromRemote(item, cache.records[item.recordId]?.payload);
        cache.records[item.recordId] = { id: item.recordId, payload };
        return { id: item.recordId, payload };
      }).filter((item) => this.matchesFilters(item.payload, filters));
      const results = all.slice(0, topK);
      await this.writeCache(cache);
      logger.info('[mem0][vector] list remote success', {
        count: results.length,
        total: all.length,
        topK,
        filters,
      });
      return [results, all.length];
    } catch (error) {
      logger.warn('[mem0][vector] list remote failed, falling back to cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      const cache = await this.readCache();
      const all = Object.values(cache.records)
        .map((item) => ({
          id: item.id,
          payload: this.normalizePayload(item.payload),
        }))
        .filter((item) => this.matchesFilters(item.payload, filters));
      return [all.slice(0, topK), all.length];
    }
  }

  async getUserId(): Promise<string> {
    if (this.userId) {
      return this.userId;
    }
    const cache = await this.readCache();
    if (cache.userId) {
      this.userId = cache.userId;
      return cache.userId;
    }
    return 'anonymous';
  }

  async setUserId(userId: string): Promise<void> {
    this.userId = userId;
    const cache = await this.readCache();
    cache.userId = userId;
    await this.writeCache(cache);
    if (this.userIdFilePath) {
      await writeFile(this.userIdFilePath, userId, 'utf8');
    }
    logger.info('[mem0][vector] setUserId', { userId });
  }

  private async readCache(): Promise<CachedVectorStoreFile> {
    await mkdir(this.cacheDir, { recursive: true });
    try {
      const raw = await readFile(this.cacheFilePath, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) as CachedVectorStoreFile : { records: {} };
      return {
        userId: parsed.userId,
        records: parsed.records ?? {},
      };
    } catch {
      return { records: {} };
    }
  }

  private async writeCache(cache: CachedVectorStoreFile): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.cacheFilePath, JSON.stringify(cache, null, 2), 'utf8');
  }

  private async upsertCache(ids: string[], payloads: Record<string, any>[]): Promise<void> {
    const cache = await this.readCache();
    ids.forEach((id, index) => {
      cache.records[id] = {
        id,
        payload: this.normalizePayload(payloads[index] || {}),
      };
    });
    if (this.userId && !cache.userId) {
      cache.userId = this.userId;
    }
    await this.writeCache(cache);
  }

  private normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    return {
      ...payload,
      user_id: payload.user_id ?? payload.userId,
      agent_id: payload.agent_id ?? payload.agentId,
      run_id: payload.run_id ?? payload.runId,
    };
  }

  /**
   * 仅持久化业务扩展字段，避免把 mem0 原始 payload（尤其 data）嵌入 metadata。
   * 实体集合依赖 linkedMemoryIds 精确关联主记忆，不能在远端同步时丢弃。
   */
  private compactMetadata(payload: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const key of [
      'memoryType',
      'confidence',
      'status',
      'textLemmatized',
      'entityType',
      'linkedMemoryIds',
      // 兼容旧版或外部调用方使用的下划线命名。
      'entity_type',
      'linked_memory_ids',
    ]) {
      if (payload[key] !== undefined) {
        metadata[key] = payload[key];
      }
    }
    return metadata;
  }

  /** 将服务端紧凑检索项还原为 mem0 VectorStore 所需 payload。 */
  private rehydratePayload(item: AgentMemorySearchResultItem): Record<string, unknown> {
    return this.normalizePayload({
      ...(item.metadata || {}),
      data: item.content,
      hash: item.hash,
      memoryScope: item.memoryType,
      user_id: item.userId,
      app_id: item.appId,
      agent_id: item.agentId,
      run_id: item.runId,
      sessionKey: item.sessionId,
      turn_id: item.turnId,
      actor_id: item.actorId,
      role: item.role,
      expiration_date: item.expirationDate,
      attributed_to: item.attributedTo,
      source: item.source,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      occurredAt: item.occurredAt,
    });
  }

  /** 服务端字段具有最终权威性；缓存仅补充旧记录未同步的扩展 payload。 */
  private payloadFromRemote(
    item: AgentMemorySearchResultItem,
    cachedPayload?: Record<string, unknown>,
  ): Record<string, unknown> {
    const embeddedPayload = item.metadata?.payload && typeof item.metadata.payload === 'object'
      ? item.metadata.payload as Record<string, unknown>
      : undefined;
    return this.normalizePayload({
      ...(cachedPayload || {}),
      ...(embeddedPayload || {}),
      ...this.rehydratePayload(item),
    });
  }

  private readString(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
      if (typeof payload[key] === 'string' && payload[key].trim()) {
        return payload[key];
      }
    }
    return undefined;
  }

  private readFilterString(filters: SearchFilters | undefined, ...keys: string[]): string | undefined {
    const values = filters as Record<string, unknown> | undefined;
    return values ? this.readString(values, ...keys) : undefined;
  }

  private readMemoryTypeFilters(filters?: SearchFilters): string[] | undefined {
    const values = filters as Record<string, unknown> | undefined;
    if (!values) {
      return undefined;
    }
    const value = values.memoryTypes ?? values.memory_types ?? values.memoryScope ?? values.memory_type;
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
      return items.length > 0 ? items : undefined;
    }
    return typeof value === 'string' && value.trim() ? [value] : undefined;
  }

  private matchesFilters(payload: Record<string, unknown>, filters?: SearchFilters): boolean {
    if (!filters) {
      return true;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) {
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        continue;
      }
      if (payload[key] !== value) {
        return false;
      }
    }
    return true;
  }
}

let patched = false;

export function patchMem0Factories(ossModule: OssModuleShape): void {
  if (patched) {
    logger.info('[mem0] patchMem0Factories skip: already patched');
    return;
  }
  patched = true;
  logger.info('[mem0] patchMem0Factories apply');

  const originalEmbedderCreate = ossModule.EmbedderFactory.create.bind(ossModule.EmbedderFactory);
  const originalLlmCreate = ossModule.LLMFactory.create.bind(ossModule.LLMFactory);
  const originalVectorCreate = ossModule.VectorStoreFactory.create.bind(ossModule.VectorStoreFactory);

  ossModule.EmbedderFactory.create = (provider: string, config: EmbeddingConfig) => {
    if (provider === MEM0_CUSTOM_EMBEDDER_PROVIDER) {
      return new StoMemoryCenterEmbedderProvider();
    }
    return originalEmbedderCreate(provider, config);
  };

  ossModule.LLMFactory.create = (provider: string, config: LLMConfig) => {
    if (provider === MEM0_CUSTOM_LLM_PROVIDER) {
      return new StoMemoryCenterLlmProvider(config);
    }
    return originalLlmCreate(provider, config);
  };

  ossModule.VectorStoreFactory.create = (provider: string, config: VectorStoreConfig) => {
    if (provider === MEM0_CUSTOM_VECTOR_PROVIDER) {
      return new StoMemoryCenterVectorStoreProvider(config as Mem0CustomVectorConfig);
    }
    return originalVectorCreate(provider, config);
  };
}

export function buildMem0CustomProviderConfig(input: {
  historyDbPath: string;
  cacheDir: string;
  userIdFilePath: string;
  llmModel?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
}) {
  logger.info('[mem0] buildMem0CustomProviderConfig', {
    historyDbPath: input.historyDbPath,
    cacheDir: input.cacheDir,
    userIdFilePath: input.userIdFilePath,
    llmModel: input.llmModel,
    embeddingModel: input.embeddingModel,
    embeddingDimension: input.embeddingDimension,
  });
  return {
    llm: {
      provider: MEM0_CUSTOM_LLM_PROVIDER,
      config: {
        model: input.llmModel,
      },
    },
    embedder: {
      provider: MEM0_CUSTOM_EMBEDDER_PROVIDER,
      config: {
        model: input.embeddingModel,
        embeddingDims: input.embeddingDimension,
      },
    },
    vectorStore: {
      provider: MEM0_CUSTOM_VECTOR_PROVIDER,
      config: {
        // Only the primary mem0 memory collection is declared here.
        // mem0 derives its entity store automatically at runtime as
        // `${collectionName}_entities`, which becomes a second remote
        // collection after our service-side mapping.
        collectionName: 'memories',
        dimension: input.embeddingDimension,
        cacheDir: input.cacheDir,
        userIdFilePath: input.userIdFilePath,
      },
    },
    historyStore: {
      provider: 'sqlite',
      config: {
        historyDbPath: input.historyDbPath,
      },
    },
    customInstructions: STO_CLAW_MEMORY_CUSTOM_INSTRUCTIONS,
    historyDbPath: input.historyDbPath,
    disableHistory: false,
  };
}

export {
  MEM0_CUSTOM_EMBEDDER_PROVIDER,
  MEM0_CUSTOM_LLM_PROVIDER,
  MEM0_CUSTOM_VECTOR_PROVIDER,
};
