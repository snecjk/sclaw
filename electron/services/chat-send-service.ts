import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType, EngineSendParams, EngineSendWithMediaParams } from '../engines/types';
import { runIdempotentChatSend } from '../api/routes/chat-send-idempotency';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';
import { agentMemoryContextService } from './agent-memory-context-service';
import { getMemoryTurnCoordinator } from './memory-turn-coordinator';
import { getChatRuntimeSupervisor } from './chat-runtime-supervisor';
import { emitAgentPreparationProgress } from './agent-preparation-progress';
import { getChatUserTurnCompositionRepository } from '../db/repositories/chat-user-turn-composition-repository';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';

type ChatSendResult = { success: boolean; result?: { runId?: string }; error?: string };

export type MainChatSendInput = EngineSendParams & {
  sourceText?: string;
  /** User-visible text before memory/system prompt decoration. */
  displayText?: string;
  engineType: AgentEngineType;
  memoryPolicy?: {
    skipRead?: boolean;
    skipWrite?: boolean;
  };
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
    const personalizedMemoryEnabled = await getSetting('personalizedMemoryEnabled').catch((error) => {
      logger.warn('[memory] failed to read personalized memory preference; keeping retrieval enabled', {
        error: String(error),
      });
      return true;
    });
    const skipRead = input.memoryPolicy?.skipRead === true || !personalizedMemoryEnabled;
    const skipWrite = input.memoryPolicy?.skipWrite === true;
    const showPreparationProgress = runtime.runtimePolicy.origin === 'interactive';
    if (showPreparationProgress && !skipRead) {
      emitAgentPreparationProgress(
        gatewayManager,
        input.sessionKey,
        input.idempotencyKey,
        'memory',
        'running',
        '正在检索相关记忆…',
      );
    }
    const turnRepository = getChatUserTurnCompositionRepository();
    const persistComposition = Boolean(input.normalizedTurn && !input.normalizedTurn.legacy);
    if (input.normalizedTurn && persistComposition) {
      try {
        await turnRepository.upsertPending({
          sessionKey: input.sessionKey,
          idempotencyKey: input.idempotencyKey,
          engineType: input.engineType,
          turn: input.normalizedTurn,
        });
      } catch (error) {
        await runtimeSupervisor.rejected({
          sessionKey: input.sessionKey,
          idempotencyKey: input.idempotencyKey,
          error: String(error),
        });
        throw error;
      }
    }
    let memory: AgentMemoryContextBlocks;
    try {
      memory = skipRead
        ? { injectedExecutionMemories: [] }
        : await agentMemoryContextService.prepare(input.sourceText?.trim() || input.message);
    } catch (error) {
      if (persistComposition) {
        await turnRepository.markRejected(input.sessionKey, input.idempotencyKey, String(error))
          .catch((sidecarError) => logger.warn('[model-message] failed to mark sidecar rejected', {
            sessionKey: input.sessionKey,
            error: String(sidecarError),
          }));
      }
      await runtimeSupervisor.rejected({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        error: String(error),
      });
      throw error;
    }
    if (showPreparationProgress && !skipRead) {
      const hasMemory = Boolean(memory.preference || memory.execution);
      emitAgentPreparationProgress(
        gatewayManager,
        input.sessionKey,
        input.idempotencyKey,
        'memory',
        'completed',
        hasMemory ? '已检索到相关记忆' : '未检索到相关记忆',
        undefined,
        memory.displayMemories?.length
          ? { memories: memory.displayMemories }
          : undefined,
      );
    }
    const coordinator = getMemoryTurnCoordinator(gatewayManager);
    if (!skipWrite) {
      coordinator.begin({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        engineType: input.engineType,
        memories: memory.injectedExecutionMemories,
      });
    }

    const prepared = prepareMemoryInjection(input, memory);

    try {
      const result = await dispatch(prepared);
      if (!result.success) {
        if (persistComposition) {
          await turnRepository.markRejected(
            input.sessionKey,
            input.idempotencyKey,
            result.error || 'Failed to send message',
          ).catch((error) => logger.warn('[model-message] failed to mark sidecar rejected', {
            sessionKey: input.sessionKey,
            error: String(error),
          }));
        }
        if (!skipWrite) coordinator.reject(input.sessionKey, input.idempotencyKey);
        await runtimeSupervisor.rejected({
          sessionKey: input.sessionKey,
          idempotencyKey: input.idempotencyKey,
          error: result.error || 'Failed to send message',
        });
        return result;
      }
      if (!skipWrite) {
        await coordinator.bind({
          sessionKey: input.sessionKey,
          idempotencyKey: input.idempotencyKey,
          runId: result.result?.runId,
        });
      }
      if (persistComposition) {
        await turnRepository.markAccepted(
          input.sessionKey,
          input.idempotencyKey,
          result.result?.runId,
        ).catch((error) => logger.warn('[model-message] failed to mark sidecar accepted', {
          sessionKey: input.sessionKey,
          error: String(error),
        }));
      }
      await runtimeSupervisor.accepted({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        runId: result.result?.runId,
        engineType: input.engineType,
        result: result.result ?? {},
      });
      return result;
    } catch (error) {
      if (persistComposition) {
        await turnRepository.markRejected(input.sessionKey, input.idempotencyKey, String(error))
          .catch((sidecarError) => logger.warn('[model-message] failed to mark sidecar rejected', {
            sessionKey: input.sessionKey,
            error: String(sidecarError),
          }));
      }
      if (!skipWrite) coordinator.reject(input.sessionKey, input.idempotencyKey);
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
