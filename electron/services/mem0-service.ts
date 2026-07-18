import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { LLM, VectorStore } from 'mem0ai/oss';

import { agentMemoryRemoteService, type AgentMemoryBootstrap } from './agent-memory-remote-service';
import { buildMem0CustomProviderConfig, patchMem0Factories } from './mem0-custom-providers';
import { logger } from '../utils/logger';
import {
  getMem0BaseDir,
  getMem0ConfigPath,
  getMem0HistoryDbPath,
  getMem0QueuePath,
  getMem0UserIdPath,
  getMem0VectorCacheDir,
} from '../utils/paths';

export interface Mem0StoragePaths {
  baseDir: string;
  historyDbPath: string;
  configPath: string;
  queuePath: string;
  vectorCacheDir: string;
  userIdPath: string;
}

export interface Mem0ServiceStatus {
  ready: boolean;
  storageReady: boolean;
  sdkAvailable: boolean;
  mode: 'phase1-remote-orchestrated';
  paths: Mem0StoragePaths;
  bootstrap?: AgentMemoryBootstrap | null;
  sdkReason?: string | null;
}

type Mem0ModuleShape = {
  Memory?: new (...args: unknown[]) => unknown;
  EmbedderFactory?: { create: (...args: unknown[]) => unknown };
  LLMFactory?: { create: (provider: string, config: Record<string, unknown>) => LLM };
  VectorStoreFactory?: { create: (provider: string, config: Record<string, unknown>) => VectorStore };
};

const MEM0_CONFIG_VERSION = 1;

function buildStoragePaths(): Mem0StoragePaths {
  return {
    baseDir: getMem0BaseDir(),
    historyDbPath: getMem0HistoryDbPath(),
    configPath: getMem0ConfigPath(),
    queuePath: getMem0QueuePath(),
    vectorCacheDir: getMem0VectorCacheDir(),
    userIdPath: getMem0UserIdPath(),
  };
}

async function ensureJsonFile(path: string, fallbackValue: unknown): Promise<void> {
  try {
    await access(path);
  } catch {
    await writeFile(path, JSON.stringify(fallbackValue, null, 2), 'utf8');
  }
}

async function tryLoadMem0Module(): Promise<{ module: Mem0ModuleShape | null; reason: string | null }> {
  try {
    // Keep every runtime peer imported by `mem0ai/oss` in the root `dependencies`.
    // electron-builder only follows dependencies/optionalDependencies when building
    // app.asar, so pnpm's auto-installed mem0 peer providers are otherwise omitted.
    // The official OSS entry is externalized in the Electron main-process build so
    // this stays a runtime-loaded optional SDK instead of being bundled twice.
    const loaded = await import('mem0ai/oss');
    return { module: loaded as Mem0ModuleShape, reason: null };
  } catch (error) {
    return {
      module: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export class Mem0Service {
  private bootstrapCache: AgentMemoryBootstrap | null = null;
  private memoryClient: unknown | null = null;
  private sdkStatus: { available: boolean; reason: string | null } = { available: false, reason: null };

  getStoragePaths(): Mem0StoragePaths {
    return buildStoragePaths();
  }

  async ensureStorageLayout(): Promise<Mem0StoragePaths> {
    const paths = this.getStoragePaths();
    logger.info('[mem0] ensureStorageLayout start', paths);
    await mkdir(paths.baseDir, { recursive: true });
    await mkdir(paths.vectorCacheDir, { recursive: true });
    await ensureJsonFile(paths.configPath, {
      version: MEM0_CONFIG_VERSION,
      mode: 'phase1-remote-orchestrated',
      createdAt: new Date().toISOString(),
    });
    await ensureJsonFile(paths.queuePath, []);
    logger.info('[mem0] ensureStorageLayout ready', {
      baseDir: paths.baseDir,
      historyDbPath: paths.historyDbPath,
      vectorCacheDir: paths.vectorCacheDir,
    });
    return paths;
  }

  async getBootstrap(forceRefresh = false): Promise<AgentMemoryBootstrap> {
    if (!forceRefresh && this.bootstrapCache) {
      logger.info('[mem0] getBootstrap cache-hit', {
        userId: this.bootstrapCache.userId,
        appId: this.bootstrapCache.appId,
      });
      return this.bootstrapCache;
    }
    logger.info('[mem0] getBootstrap request', { forceRefresh });
    this.bootstrapCache = await agentMemoryRemoteService.getBootstrap();
    logger.info('[mem0] getBootstrap success', {
      enabled: this.bootstrapCache.enabled,
      userId: this.bootstrapCache.userId,
      appId: this.bootstrapCache.appId,
      vectorProvider: this.bootstrapCache.routing?.vectorProvider,
    });
    await this.persistBootstrapSnapshot(this.bootstrapCache);
    return this.bootstrapCache;
  }

  async initialize(): Promise<Mem0ServiceStatus> {
    logger.info('[mem0] initialize start');
    const paths = await this.ensureStorageLayout();
    const [bootstrap, sdk] = await Promise.all([
      this.getBootstrap(false).catch(() => null),
      tryLoadMem0Module(),
    ]);
    logger.info('[mem0] initialize dependencies resolved', {
      bootstrapReady: Boolean(bootstrap),
      sdkAvailable: Boolean(sdk.module?.Memory),
      sdkReason: sdk.reason,
    });
    this.sdkStatus = { available: Boolean(sdk.module?.Memory), reason: sdk.reason };
    if (bootstrap?.enabled === false) {
      logger.info('[mem0] initialize skipped: disabled by server rollout', {
        userId: bootstrap.userId,
      });
      return {
        ready: false,
        storageReady: true,
        sdkAvailable: Boolean(sdk.module?.Memory),
        mode: 'phase1-remote-orchestrated',
        paths,
        bootstrap,
        sdkReason: 'Agent Memory is disabled for the current user',
      };
    }
    if (sdk.module?.Memory && sdk.module.EmbedderFactory && sdk.module.LLMFactory && sdk.module.VectorStoreFactory) {
      logger.info('[mem0] patch factories start');
      patchMem0Factories(sdk.module as unknown as Parameters<typeof patchMem0Factories>[0]);
      this.memoryClient = await this.createMemoryClient(sdk.module, bootstrap, paths);
      logger.info('[mem0] memory client created', { ready: Boolean(this.memoryClient) });
    } else {
      logger.warn('[mem0] sdk incomplete, skip client create', {
        hasMemory: Boolean(sdk.module?.Memory),
        hasEmbedderFactory: Boolean(sdk.module?.EmbedderFactory),
        hasLlmFactory: Boolean(sdk.module?.LLMFactory),
        hasVectorStoreFactory: Boolean(sdk.module?.VectorStoreFactory),
      });
    }
    const status: Mem0ServiceStatus = {
      ready: Boolean(bootstrap && this.memoryClient),
      storageReady: true,
      sdkAvailable: Boolean(sdk.module?.Memory),
      mode: 'phase1-remote-orchestrated',
      paths,
      bootstrap,
      sdkReason: sdk.reason,
    };
    logger.info('[mem0] initialize done', {
      ready: status.ready,
      storageReady: status.storageReady,
      sdkAvailable: status.sdkAvailable,
    });
    return status;
  }

  async getStatus(): Promise<Mem0ServiceStatus> {
    const paths = this.getStoragePaths();
    let storageReady = true;
    try {
      await access(paths.configPath);
      await access(paths.queuePath);
    } catch {
      storageReady = false;
    }
    const sdk = await tryLoadMem0Module();
    return {
      ready: storageReady && this.bootstrapCache !== null && this.memoryClient !== null,
      storageReady,
      sdkAvailable: Boolean(sdk.module?.Memory),
      mode: 'phase1-remote-orchestrated',
      paths,
      bootstrap: this.bootstrapCache,
      sdkReason: sdk.reason,
    };
  }

  async getClient<T = unknown>(): Promise<T> {
    if (!this.memoryClient) {
      logger.info('[mem0] getClient lazy initialize');
      await this.initialize();
    }
    if (!this.memoryClient) {
      if (this.bootstrapCache?.enabled === false) {
        throw new Error('Agent Memory is disabled for the current user');
      }
      logger.error('[mem0] getClient failed', { sdkReason: this.sdkStatus.reason });
      throw new Error(this.sdkStatus.reason || 'Mem0 client is not initialized');
    }
    return this.memoryClient as T;
  }

  async add(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, options?: Record<string, unknown>) {
    logger.info('[mem0] add start', {
      messageCount: messages.length,
      roles: messages.map((item) => item.role),
      hasOptions: Boolean(options),
    });
    const client = await this.getClient<{ add: (messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) => Promise<unknown> }>();
    const result = await client.add(messages, options);
    logger.info('[mem0] add success');
    return result;
  }

  async search(query: string, options: { filters: Record<string, unknown>; topK?: number }) {
    logger.info('[mem0] search start', {
      queryLength: query.length,
      topK: options.topK,
      filters: options.filters,
    });
    const client = await this.getClient<{ search: (query: string, options: { filters: Record<string, unknown>; topK?: number }) => Promise<unknown> }>();
    const result = await client.search(query, options);
    logger.info('[mem0] search success');
    return result;
  }

  async getAll(options: { filters: Record<string, unknown>; topK?: number }) {
    logger.info('[mem0] getAll start', {
      topK: options.topK,
      filters: options.filters,
    });
    const client = await this.getClient<{ getAll: (options: { filters: Record<string, unknown>; topK?: number }) => Promise<unknown> }>();
    const result = await client.getAll(options);
    logger.info('[mem0] getAll success');
    return result;
  }

  async delete(memoryId: string) {
    logger.info('[mem0] delete start', { memoryId });
    const client = await this.getClient<{ delete: (memoryId: string) => Promise<unknown> }>();
    const result = await client.delete(memoryId);
    logger.info('[mem0] delete success', { memoryId });
    return result;
  }

  async deleteAll(options: Record<string, unknown>) {
    logger.info('[mem0] deleteAll start', { options });
    const client = await this.getClient<{ deleteAll: (options: Record<string, unknown>) => Promise<unknown> }>();
    const result = await client.deleteAll(options);
    logger.info('[mem0] deleteAll success');
    return result;
  }

  async history(memoryId: string) {
    logger.info('[mem0] history start', { memoryId });
    const client = await this.getClient<{ history: (memoryId: string) => Promise<unknown> }>();
    const result = await client.history(memoryId);
    logger.info('[mem0] history success', { memoryId });
    return result;
  }

  async reset() {
    logger.info('[mem0] reset start');
    const client = await this.getClient<{ reset: () => Promise<unknown> }>();
    const result = await client.reset();
    logger.info('[mem0] reset success');
    return result;
  }

  private async persistBootstrapSnapshot(bootstrap: AgentMemoryBootstrap): Promise<void> {
    const paths = await this.ensureStorageLayout();
    try {
      const raw = await readFile(paths.configPath, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {};
      await writeFile(
        paths.configPath,
        JSON.stringify(
          {
            ...parsed,
            version: MEM0_CONFIG_VERSION,
            lastBootstrapAt: new Date().toISOString(),
            bootstrap,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      await writeFile(
        paths.configPath,
        JSON.stringify(
          {
            version: MEM0_CONFIG_VERSION,
            lastBootstrapAt: new Date().toISOString(),
            bootstrap,
          },
          null,
          2,
        ),
        'utf8',
      );
    }
  }

  private async createMemoryClient(
    sdkModule: Mem0ModuleShape,
    bootstrap: AgentMemoryBootstrap | null,
    paths: Mem0StoragePaths,
  ): Promise<unknown | null> {
    if (!sdkModule.Memory) {
      logger.warn('[mem0] createMemoryClient skipped: sdkModule.Memory missing');
      return null;
    }
    logger.info('[mem0] createMemoryClient config', {
      historyDbPath: paths.historyDbPath,
      cacheDir: paths.vectorCacheDir,
      userIdFilePath: paths.userIdPath,
      llmModelSource: 'login-synced-sto-provider',
      embeddingModel: typeof bootstrap?.embedder?.model === 'string' ? bootstrap.embedder.model : undefined,
      embeddingDimension: typeof bootstrap?.embedder?.dimension === 'number' ? bootstrap.embedder.dimension : 1536,
    });
    return new sdkModule.Memory(
      buildMem0CustomProviderConfig({
        historyDbPath: paths.historyDbPath,
        cacheDir: paths.vectorCacheDir,
        userIdFilePath: paths.userIdPath,
        embeddingModel: typeof bootstrap?.embedder?.model === 'string' ? bootstrap.embedder.model : undefined,
        embeddingDimension: typeof bootstrap?.embedder?.dimension === 'number' ? bootstrap.embedder.dimension : 1536,
      }),
    );
  }

}

export const mem0Service = new Mem0Service();
