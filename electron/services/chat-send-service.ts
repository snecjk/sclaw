import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType, EngineSendParams } from '../engines/types';
import { runIdempotentChatSend } from '../api/routes/chat-send-idempotency';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';
import { agentMemoryContextService } from './agent-memory-context-service';
import { getMemoryTurnCoordinator } from './memory-turn-coordinator';
import { getChatRuntimeSupervisor } from './chat-runtime-supervisor';
import type { ChatRuntimePolicy } from '../../shared/chat-runtime-protocol';

type ChatSendResult = { success: boolean; result?: { runId?: string }; error?: string };

export type MainChatSendInput = EngineSendParams & {
  sourceText?: string;
  engineType: AgentEngineType;
  runtimePolicy?: ChatRuntimePolicy;
};

export function runMainChatSend(
  gatewayManager: GatewayManager,
  input: MainChatSendInput,
  prepareMemoryInjection: (params: EngineSendParams, memory: AgentMemoryContextBlocks) => EngineSendParams,
  dispatch: (prepared: EngineSendParams) => Promise<ChatSendResult>,
): Promise<ChatSendResult> {
  return runIdempotentChatSend(input.sessionKey, input.idempotencyKey, async () => {
    const runtimeSupervisor = getChatRuntimeSupervisor(gatewayManager);
    const runtime = await runtimeSupervisor.begin({
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      engineType: input.engineType,
      runtimePolicy: input.runtimePolicy,
    });
    if (
      runtime.acceptanceResult
      && Date.now() - runtime.startedAt <= 10 * 60 * 1000
      && runtime.phase !== 'failed'
      && runtime.phase !== 'interrupted'
    ) {
      return { success: true, result: runtime.acceptanceResult as { runId?: string } };
    }
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
        await runtimeSupervisor.rejected({
          sessionKey: input.sessionKey,
          idempotencyKey: input.idempotencyKey,
          error: result.error || 'Failed to send message',
        });
        return result;
      }
      await coordinator.bind({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        runId: result.result?.runId,
      });
      await runtimeSupervisor.accepted({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        runId: result.result?.runId,
        engineType: input.engineType,
        result: result.result ?? {},
      });
      return result;
    } catch (error) {
      coordinator.reject(input.sessionKey, input.idempotencyKey);
      await runtimeSupervisor.rejected({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        error: String(error),
        uncertain: /timeout|network|ECONN|fetch failed/i.test(String(error)),
      });
      throw error;
    }
  });
}
