import { agentMemoryRemoteService } from './agent-memory-remote-service';

export class StoMemoryCenterEmbedder {
  async createEmbeddings(input: string | string[], model?: string): Promise<{
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    usage?: Record<string, unknown>;
  }> {
    return await agentMemoryRemoteService.createEmbeddings(input, model);
  }

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    const response = await this.createEmbeddings(input, model);
    return response.embeddings
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }
}

export const stoMemoryCenterEmbedder = new StoMemoryCenterEmbedder();
