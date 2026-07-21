import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType, EngineSendParams } from '../engines/types';
import { runIdempotentChatSend } from '../api/routes/chat-send-idempotency';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';
import { agentMemoryContextService } from './agent-memory-context-service';
import { getMemoryTurnCoordinator } from './memory-turn-coordinator';

type ChatSendResult = { success: boolean; result?: { runId?: string }; error?: string };

export type MainChatSendInput = EngineSendParams & {
  sourceText?: string;
  engineType: AgentEngineType;
};

export function runMainChatSend(
  gatewayManager: GatewayManager,
  input: MainChatSendInput,
  prepareMemoryInjection: (params: EngineSendParams, memory: AgentMemoryContextBlocks) => EngineSendParams,
  dispatch: (prepared: EngineSendParams) => Promise<ChatSendResult>,
): Promise<ChatSendResult> {
  return runIdempotentChatSend(input.sessionKey, input.idempotencyKey, async () => {
    const memory = await agentMemoryContextService.prepare(input.sourceText?.trim() || input.message);
    const coordinator = getMemoryTurnCoordinator(gatewayManager);
    coordinator.begin({
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      engineType: input.engineType,
      memories: memory.injectedExecutionMemories,
    });

    const prepared = prepareMemoryInjection(input, memory);

    try {
      const result = await dispatch(prepared);
      if (!result.success) {
        coordinator.reject(input.sessionKey, input.idempotencyKey);
        return result;
      }
      await coordinator.bind({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        runId: result.result?.runId,
      });
      return result;
    } catch (error) {
      coordinator.reject(input.sessionKey, input.idempotencyKey);
      throw error;
    }
  });
}
