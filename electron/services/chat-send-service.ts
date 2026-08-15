import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType, EngineSendParams, EngineSendWithMediaParams } from '../engines/types';
import { runIdempotentChatSend } from '../api/routes/chat-send-idempotency';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';
import { agentMemoryContextService } from './agent-memory-context-service';
import { getMemoryTurnCoordinator } from './memory-turn-coordinator';
import { getChatRuntimeSupervisor } from './chat-runtime-supervisor';

type ChatSendResult = { success: boolean; result?: { runId?: string }; error?: string };

export type MainChatSendInput = EngineSendParams & {
  sourceText?: string;
  /** User-visible text before memory/system prompt decoration. */
  displayText?: string;
  engineType: AgentEngineType;
  /** 定时任务等：真实挂载的本地文件（透传到 sendMessageWithMedia） */
  media?: EngineSendWithMediaParams['media'];
};

export function runMainChatSend(
  gatewayManager: GatewayManager,
  input: MainChatSendInput,
  prepareMemoryInjection: (params: EngineSendParams, memory: AgentMemoryContextBlocks) => EngineSendParams,
  dispatch: (prepared: EngineSendParams) => Promise<ChatSendResult>,
): Promise<ChatSendResult> {
  return runIdempotentChatSend(input.sessionKey, input.idempotencyKey, async () => {
    const runtimeSupervisor = getChatRuntimeSupervisor(gatewayManager);
    const beginResult = await runtimeSupervisor.begin({
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      engineType: input.engineType,
      runtimePolicy: input.runtimePolicy,
      displayText: input.displayText?.trim() || input.sourceText?.trim() || input.message,
    });
    if (beginResult.kind === 'unavailable') {
      return { success: false, error: beginResult.error };
    }
    const runtime = beginResult.snapshot;
    if (beginResult.kind === 'expired_key') {
      return { success: false, error: 'IDEMPOTENCY_KEY_EXPIRED: generate a new idempotency key for a new send' };
    }
    if (beginResult.kind === 'replay') {
      if (runtime.acceptanceResult) {
        return { success: true, result: runtime.acceptanceResult as { runId?: string } };
      }
      return {
        success: false,
        error: runtime.error ?? `IDEMPOTENT_REPLAY_${runtime.phase.toUpperCase()}`,
      };
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
