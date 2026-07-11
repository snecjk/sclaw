import {
  type AgentMemoryBootstrap,
  type AgentMemorySearchResultItem,
} from './agent-memory-remote-service';
import { mem0Service } from './mem0-service';
import { stoMemoryCenterEmbedder } from './sto-memory-center-embedder';
import { stoMemoryCenterLlm } from './sto-memory-center-llm';
import { stoMemoryCenterVectorStore } from './sto-memory-center-vector-store';
import { claudeExecutionSummaryService, type ExecutionExperienceSummary } from './claude-execution-summary-service';

export interface AgentMemoryIndexDraft {
  recordId: string;
  content: string;
  memoryType?: string;
  occurredAt?: string;
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  source?: string;
  appId?: string;
  metadata?: Record<string, unknown>;
}

export class AgentMemoryOrchestrator {
  async initialize() {
    return await mem0Service.initialize();
  }

  async getStatus() {
    return await mem0Service.getStatus();
  }

  async getBootstrap(forceRefresh = false): Promise<AgentMemoryBootstrap> {
    return await mem0Service.getBootstrap(forceRefresh);
  }

  async indexRecords(records: AgentMemoryIndexDraft[]) {
    if (records.length === 0) {
      return { accepted: 0, embedded: 0, failed: 0 };
    }
    const vectors = await stoMemoryCenterEmbedder.embed(records.map((item) => item.content));
    if (vectors.length !== records.length) {
      throw new Error('Embedding result count mismatch');
    }
    return await stoMemoryCenterVectorStore.upsert(
      records.map((record, index) => ({
        ...record,
        vector: vectors[index],
      })),
    );
  }

  async addMemories(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, options?: {
    userId?: string;
    agentId?: string;
    runId?: string;
    metadata?: Record<string, unknown>;
    infer?: boolean;
  }) {
    return await mem0Service.add(messages, options);
  }

  async search(query: string, options?: {
    topK?: number;
    userId?: string;
    agentId?: string;
    runId?: string;
    sessionId?: string;
    memoryTypes?: string[];
  }): Promise<{
    items: AgentMemorySearchResultItem[];
    topK: number;
    count: number;
  }> {
    const [vector] = await stoMemoryCenterEmbedder.embed(query);
    if (!vector) {
      throw new Error('Embedding result is empty');
    }
    return await stoMemoryCenterVectorStore.search({
      vector,
      topK: options?.topK,
      agentId: options?.agentId,
      sessionId: options?.sessionId,
      memoryTypes: options?.memoryTypes,
    });
  }

  async delete(recordIds: string[]) {
    return await stoMemoryCenterVectorStore.delete(recordIds);
  }

  async searchMemories(query: string, options: {
    userId?: string;
    agentId?: string;
    runId?: string;
    topK?: number;
  }) {
    const filters = Object.fromEntries(
      Object.entries({
        user_id: options.userId,
        agent_id: options.agentId,
        run_id: options.runId,
      }).filter(([, value]) => typeof value === 'string' && value.length > 0),
    );
    return await mem0Service.search(query, {
      filters,
      topK: options.topK,
    });
  }

  async getAllMemories(options: {
    userId?: string;
    agentId?: string;
    runId?: string;
    topK?: number;
  }) {
    const filters = Object.fromEntries(
      Object.entries({
        user_id: options.userId,
        agent_id: options.agentId,
        run_id: options.runId,
      }).filter(([, value]) => typeof value === 'string' && value.length > 0),
    );
    return await mem0Service.getAll({
      filters,
      topK: options.topK,
    });
  }

  async deleteMemory(memoryId: string) {
    return await mem0Service.delete(memoryId);
  }

  async deleteAllMemories(options: {
    userId?: string;
    agentId?: string;
    runId?: string;
  }) {
    const payload = Object.fromEntries(
      Object.entries({
        userId: options.userId,
        agentId: options.agentId,
        runId: options.runId,
      }).filter(([, value]) => typeof value === 'string' && value.length > 0),
    );
    return await mem0Service.deleteAll(payload);
  }

  async getMemoryHistory(memoryId: string) {
    return await mem0Service.history(memoryId);
  }

  async resetMemories() {
    return await mem0Service.reset();
  }

  async listModels() {
    return await stoMemoryCenterLlm.listModels();
  }

  async createChatCompletion(payload: Record<string, unknown>) {
    return await stoMemoryCenterLlm.createChatCompletion(payload);
  }

  async summarizeExecutionExperience(input: Record<string, unknown>): Promise<ExecutionExperienceSummary> {
    return await claudeExecutionSummaryService.summarize(input);
  }
}

export const agentMemoryOrchestrator = new AgentMemoryOrchestrator();
