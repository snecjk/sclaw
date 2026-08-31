import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../../../gateway/manager';
import { getAdapter, resolveAgentEngineType } from '../../../engines/manager';
import type { AgentEngineType, EngineAdapterContext } from '../../../engines/types';
import { runMainChatSend } from '../../../services/chat-send-service';
import { getChatRuntimeSupervisor } from '../../../services/chat-runtime-supervisor';
import type { CanonicalChatEvent } from '../../../../shared/chat-runtime-protocol';
import { createBridgeAiSessionKey } from '../../../../shared/bridge-ai-session';
import {
  BRIDGE_AI_DEFAULT_TIMEOUT_MS,
  BRIDGE_AI_MAX_CONTEXT_BYTES,
  BRIDGE_AI_MAX_TIMEOUT_MS,
  type BridgeAiFinishReason,
  type ChatCompleteParams,
  type ChatCompleteResult,
} from '../../../../shared/jsbridge/bridge-ai-protocol';
import { isBridgeAiEnabled } from '../../../../shared/jsbridge/trust-policy';
import type { BridgeSession } from './session-registry';
import {
  buildBridgeAiSystemPromptAppend,
  extractAssistantTextFromHistory,
  extractCanonicalMessageText,
  measureBridgeAiContextBytes,
  mergeBridgeAiStreamText,
  parseBridgeAiResponse,
} from './bridge-ai-message';
import {
  getBridgeAiRun,
  registerBridgeAiRun,
  unregisterBridgeAiRun,
} from './bridge-ai-registry';
import {
  appendBridgeAiSkillPrompt,
  resolveBridgeAiInvocationPlan,
} from './bridge-ai-profile';
import { acquireBridgeAiQuota } from './bridge-ai-quota';
import { logBridgeAiAudit } from './bridge-ai-audit';
import { logger } from '../../../utils/logger';

let gatewayManagerRef: GatewayManager | null = null;

async function resolveGatewayManager(): Promise<GatewayManager | null> {
  if (gatewayManagerRef) return gatewayManagerRef;
  try {
    const mainModule = await import('../../index');
    gatewayManagerRef = mainModule.gatewayManager ?? null;
    return gatewayManagerRef;
  } catch (error) {
    logger.warn('[bridge-ai] failed to resolve gatewayManager', error);
    return null;
  }
}

function bridgeAiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return BRIDGE_AI_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(1_000, Math.floor(timeoutMs)), BRIDGE_AI_MAX_TIMEOUT_MS);
}

function terminalFinishReason(event: CanonicalChatEvent): BridgeAiFinishReason {
  if (event.type === 'run.completed') return 'completed';
  if (event.type === 'run.aborted') return 'aborted';
  if (event.type === 'run.interrupted') {
    const payload = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : {};
    return payload.reason === 'hard-deadline' ? 'timeout' : 'failed';
  }
  return 'failed';
}

async function loadAssistantTextFallback(
  gatewayManager: GatewayManager,
  sessionKey: string,
  engineType: AgentEngineType,
): Promise<string> {
  try {
    const adapter = getAdapter(engineType);
    const history = await adapter.getHistory(
      { gatewayManager } satisfies EngineAdapterContext,
      { sessionKey, limit: 40 },
    );
    return extractAssistantTextFromHistory(history.messages);
  } catch (error) {
    logger.debug('[bridge-ai] transcript fallback failed', { sessionKey, error });
    return '';
  }
}

function createBridgeAiTerminalWaiter(input: {
  gatewayManager: GatewayManager;
  supervisor: ReturnType<typeof getChatRuntimeSupervisor>;
  sessionKey: string;
  ownerId: string;
  engineType: AgentEngineType;
  timeoutMs: number;
}) {
  let text = '';
  let runId: string | null = null;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (result: {
    text: string;
    finishReason: BridgeAiFinishReason;
    runId: string | null;
    error?: string;
  }) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(result);
  };

  let resolvePromise!: (value: {
    text: string;
    finishReason: BridgeAiFinishReason;
    runId: string | null;
    error?: string;
  }) => void;

  const promise = new Promise<{
    text: string;
    finishReason: BridgeAiFinishReason;
    runId: string | null;
    error?: string;
  }>((resolve) => {
    resolvePromise = resolve;
  });

  const matchesRun = (event: CanonicalChatEvent): boolean => (
    event.sessionKey === input.sessionKey
    && event.runtimePolicy?.origin === 'bridge'
    && event.runtimePolicy?.ownerId === input.ownerId
  );

  const onEvent = (event: CanonicalChatEvent) => {
    if (!matchesRun(event)) return;
    if (event.runId) runId = event.runId;

    if (event.type === 'message.delta' || event.type === 'message.final') {
      const chunk = extractCanonicalMessageText(event.payload);
      if (chunk) text = mergeBridgeAiStreamText(text, chunk);
    }

    if (event.type === 'run.completed'
      || event.type === 'run.failed'
      || event.type === 'run.aborted'
      || event.type === 'run.interrupted') {
      void (async () => {
        let finalText = text;
        if (!finalText.trim()) {
          finalText = await loadAssistantTextFallback(
            input.gatewayManager,
            input.sessionKey,
            input.engineType,
          );
        }
        const payload = event.payload && typeof event.payload === 'object'
          ? event.payload as Record<string, unknown>
          : {};
        const error = typeof payload.error === 'string'
          ? payload.error
          : typeof payload.reason === 'string'
            ? payload.reason
            : event.type === 'run.failed' ? 'run failed' : undefined;
        finish({
          text: finalText,
          finishReason: terminalFinishReason(event),
          runId,
          error,
        });
      })();
    }
  };

  const abort = () => {
    if (settled) return;
    void (async () => {
      try {
        const adapter = getAdapter(input.engineType);
        await adapter.abortRun(
          { gatewayManager: input.gatewayManager },
          { sessionKey: input.sessionKey, runId: runId ?? undefined },
        );
      } catch (error) {
        logger.debug('[bridge-ai] abort failed', { sessionKey: input.sessionKey, error });
      }
      finish({ text, finishReason: 'aborted', runId });
    })();
  };

  const cleanup = () => {
    input.supervisor.off('event', onEvent);
    if (timer) clearTimeout(timer);
  };

  input.supervisor.on('event', onEvent);
  timer = setTimeout(() => {
    void (async () => {
      try {
        const adapter = getAdapter(input.engineType);
        await adapter.abortRun(
          { gatewayManager: input.gatewayManager },
          { sessionKey: input.sessionKey, runId: runId ?? undefined },
        );
      } catch (error) {
        logger.debug('[bridge-ai] timeout abort failed', { sessionKey: input.sessionKey, error });
      }
      finish({ text, finishReason: 'timeout', runId, error: 'timeout' });
    })();
  }, input.timeoutMs);

  return { promise, abort, cleanup, setRunId: (nextRunId: string | null) => { runId = nextRunId; } };
}

export async function completeBridgeAiInvocation(
  session: BridgeSession,
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const startedAt = Date.now();
  const appId = session.trustPolicy.appId;

  if (!isBridgeAiEnabled(session.trustPolicy)) {
    logBridgeAiAudit({
      appId,
      capability: 'chat.complete',
      requestId: 'n/a',
      promptLength: params.prompt?.length ?? 0,
      contextLength: measureBridgeAiContextBytes(params.context),
      errorCode: 'AI_NOT_ENABLED',
      durationMs: Date.now() - startedAt,
    });
    throw bridgeAiError('AI_NOT_ENABLED', 'AI profile is not enabled for this app');
  }

  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw bridgeAiError('AI_INVALID_PARAMS', 'prompt is required');
  }

  const contextBytes = measureBridgeAiContextBytes(params.context);
  if (contextBytes > BRIDGE_AI_MAX_CONTEXT_BYTES) {
    throw bridgeAiError('AI_CONTEXT_TOO_LARGE', `context exceeds ${BRIDGE_AI_MAX_CONTEXT_BYTES} bytes`);
  }

  const profile = session.trustPolicy.ai!;
  let plan;
  try {
    plan = resolveBridgeAiInvocationPlan(profile, params);
  } catch (error) {
    const code = (error as Error & { code?: string }).code ?? 'AI_INVALID_PARAMS';
    throw bridgeAiError(code, error instanceof Error ? error.message : String(error));
  }

  const gatewayManager = await resolveGatewayManager();
  if (!gatewayManager?.isConnected()) {
    throw bridgeAiError('AI_RUN_FAILED', 'AI gateway is not ready');
  }

  const requestId = randomUUID();
  const ownerId = requestId;
  const idempotencyKey = `bridge-ai:${requestId}`;
  const sessionKey = createBridgeAiSessionKey(plan.agentId, appId, params.conversationId);
  const timeoutMs = resolveTimeoutMs(params.timeoutMs);

  const quota = acquireBridgeAiQuota({
    appId,
    perMinute: plan.quota.perMinute,
    concurrent: plan.quota.concurrent,
    sessionKey,
  });
  if (!quota.ok) {
    logBridgeAiAudit({
      appId,
      capability: 'chat.complete',
      requestId,
      promptLength: prompt.length,
      contextLength: contextBytes,
      errorCode: quota.code,
      durationMs: Date.now() - startedAt,
    });
    throw bridgeAiError(quota.code, quota.code === 'AI_QUOTA_EXCEEDED'
      ? 'AI per-minute quota exceeded'
      : 'AI concurrent run limit exceeded');
  }

  const engineType = await resolveAgentEngineType(plan.agentId);
  const adapter = getAdapter(engineType);
  const supervisor = getChatRuntimeSupervisor(gatewayManager);
  const systemPromptAppend = appendBridgeAiSkillPrompt(
    buildBridgeAiSystemPromptAppend(plan.systemPrompt, params.context),
    plan.skillSlugs,
  );

  const waiter = createBridgeAiTerminalWaiter({
    gatewayManager,
    supervisor,
    sessionKey,
    ownerId,
    engineType,
    timeoutMs,
  });

  registerBridgeAiRun({
    requestId,
    sessionKey,
    appId,
    webContentsId: session.webContentsId,
    ownerId,
    idempotencyKey,
    runId: null,
    startedAt,
    abort: waiter.abort,
  });

  try {
    const sendResult = await runMainChatSend(
      gatewayManager,
      {
        sessionKey,
        message: prompt,
        sourceText: prompt,
        displayText: prompt,
        deliver: false,
        idempotencyKey,
        systemPromptAppend,
        engineType,
        runtimePolicy: {
          origin: 'bridge',
          ownerId,
          deadlineAt: startedAt + timeoutMs,
        },
        memoryPolicy: {
          skipRead: plan.skipMemoryRead,
          skipWrite: plan.skipMemoryWrite,
        },
      },
      plan.skipMemoryRead
        ? (prepared) => prepared
        : (prepared, memory) => adapter.prepareMemoryInjection(prepared, memory),
      (prepared) => adapter.sendMessage({ gatewayManager }, prepared),
    );

    if (!sendResult.success) {
      throw bridgeAiError('AI_RUN_FAILED', sendResult.error ?? 'failed to start AI run');
    }

    if (sendResult.result?.runId) {
      const record = getBridgeAiRun(requestId);
      if (record) record.runId = sendResult.result.runId;
      waiter.setRunId(sendResult.result.runId);
    }

    const terminal = await waiter.promise;
    const parsedResult = parseBridgeAiResponse(terminal.text, plan.responseFormat);
    logBridgeAiAudit({
      appId,
      capability: 'chat.complete',
      requestId,
      promptLength: prompt.length,
      contextLength: contextBytes,
      finishReason: terminal.finishReason,
      durationMs: Date.now() - startedAt,
      errorCode: terminal.error,
    });
    return {
      requestId,
      runId: terminal.runId,
      text: terminal.text,
      ...parsedResult,
      finishReason: terminal.finishReason,
    };
  } catch (error) {
    const code = (error as Error & { code?: string }).code ?? 'AI_RUN_FAILED';
    logBridgeAiAudit({
      appId,
      capability: 'chat.complete',
      requestId,
      promptLength: prompt.length,
      contextLength: contextBytes,
      errorCode: code,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    quota.release();
    waiter.cleanup();
    unregisterBridgeAiRun(requestId);
  }
}

export async function cancelBridgeAiInvocation(
  session: BridgeSession,
  requestId: string,
): Promise<{ ok: boolean }> {
  const record = getBridgeAiRun(requestId);
  if (!record) return { ok: false };
  if (record.appId !== session.trustPolicy.appId || record.webContentsId !== session.webContentsId) {
    return { ok: false };
  }
  record.abort?.();
  unregisterBridgeAiRun(requestId);
  return { ok: true };
}
