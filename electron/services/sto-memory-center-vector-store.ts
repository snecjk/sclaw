import {
  agentMemoryRemoteService,
  type AgentMemoryIndexRecordInput,
  type AgentMemorySearchResultItem,
} from './agent-memory-remote-service';

export class StoMemoryCenterVectorStore {
  async upsert(records: AgentMemoryIndexRecordInput[]): Promise<{
    accepted: number;
    embedded: number;
    failed: number;
  }> {
    return await agentMemoryRemoteService.upsertVectors(records);
  }

  async search(params: {
    vector: number[];
    topK?: number;
    agentId?: string;
    runId?: string;
    sessionId?: string;
    memoryTypes?: string[];
  }): Promise<{
    items: AgentMemorySearchResultItem[];
    topK: number;
    count: number;
  }> {
    return await agentMemoryRemoteService.searchVectors(params);
  }

  async delete(recordIds: string[]): Promise<{ deleted: number }> {
    return await agentMemoryRemoteService.deleteVectors(recordIds);
  }
}

export const stoMemoryCenterVectorStore = new StoMemoryCenterVectorStore();
