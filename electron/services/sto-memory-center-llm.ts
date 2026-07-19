import { agentMemoryRemoteService } from './agent-memory-remote-service';

export const STO_MEMORY_CENTER_LLM_MODEL = 'qwen3.6-plus';

export class StoMemoryCenterLlm {
  async listModels(): Promise<{ object?: string; data?: Array<Record<string, unknown>> }> {
    return await agentMemoryRemoteService.listModels();
  }

  async createChatCompletion(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await agentMemoryRemoteService.createChatCompletion(payload);
  }
}

export const stoMemoryCenterLlm = new StoMemoryCenterLlm();
