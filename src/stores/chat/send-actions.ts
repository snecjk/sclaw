import { cacheUploadedAttachments } from './media-preview-cache';
import { setRuntimePatch } from './runtime-controller';
import { dispatchChatRequest } from './dispatch-chat-request';
import { insertOptimisticUserTurn } from './optimistic-turn';
import { prepareSendContext } from './prepare-send-context';
import { resolveSendTarget } from './resolve-send-target';
import { scheduleSendWatchdogs } from './send-watchdogs';
import { logChatFlow } from './chat-flow-log';
import { useGatewayStore } from '../gateway';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { DEFAULT_SESSION_KEY, type ChatSession, type SendMessageOptions, type SessionRuntimeState } from './types';
import { getSessionRuntimeState } from './session-runtime';
import { normalizeAppError } from '@/lib/error-model';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
import { resolveSkillGatewayText } from '@/lib/skill-gateway-text';
import { appendSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import { awaitSessionSendReadiness } from '@/lib/session-send-readiness';
import { discardAgentMemoriesForAbnormalTurn } from '@/lib/agent-execution-memory';
import { releaseSendAttempt, tryAcquireSendAttempt } from './send-attempt-lock';
import { recordTerminalRun } from './run-lifecycle';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import { getAgentIdFromSessionKey } from './session-identity';

export function isUncertainDispatchError(error: unknown): boolean {
  const code = normalizeAppError(error).code;
  return code === 'TIMEOUT' || code === 'NETWORK';
}

export function buildUncertainAcceptancePatch(
  runtime: SessionRuntimeState,
  idempotencyKey: string,
): Partial<SessionRuntimeState> {
  if (!runtime.sendAcceptance || runtime.sendAcceptance.idempotencyKey !== idempotencyKey) return {};
  return {
    sending: true,
    error: null,
    sendAcceptance: { ...runtime.sendAcceptance, status: 'uncertain' },
  };
}

function failSendTurn(input: {
  set: ChatSet;
  clearHistoryPoll: (sessionKey: string) => void;
  clearStuckCheckTimer?: (sessionKey: string) => void;
  sessionKey: string;
  error: string;
}): void {
  discardAgentMemoriesForAbnormalTurn({
    sessionKey: input.sessionKey,
    reason: 'failed',
  });
  input.clearHistoryPoll(input.sessionKey);
  input.clearStuckCheckTimer?.(input.sessionKey);
  setRuntimePatch(input.set, input.sessionKey, {
    sending: false,
    aborting: false,
    activeRunId: null,
    sendAcceptance: null,
    pendingFinal: false,
    error: input.error,
  });
}

export interface SendActionsDeps {
  normalizeSendMessageOptions: (args: unknown[]) => SendMessageOptions;
  resolveMainSessionKeyForAgent: (agentId: string | undefined | null) => string | null;
  buildSessionSwitchPatch: (state: ReturnType<ChatGet>, nextSessionKey: string) => Partial<ReturnType<ChatGet>>;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
    options?: { messageCount?: number },
  ) => ChatSession['engineType'] | undefined;
  clearErrorRecoveryTimer: (sessionKey: string) => void;
  clearHistoryPoll: (sessionKey: string) => void;
  setHistoryPollTimer: (sessionKey: string, timer: ReturnType<typeof setTimeout> | null) => void;
  clearStuckCheckTimer: (sessionKey: string) => void;
  setStuckCheckTimer: (sessionKey: string, timer: ReturnType<typeof setTimeout> | null) => void;
}

export function createSendActions(
  set: ChatSet,
  get: ChatGet,
  deps: SendActionsDeps,
): Pick<RuntimeActions, 'sendMessage' | 'abortRun'> {
  const {
    normalizeSendMessageOptions,
    resolveMainSessionKeyForAgent,
    buildSessionSwitchPatch,
    resolveEngineTypeForSession,
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    setHistoryPollTimer,
    clearStuckCheckTimer,
    setStuckCheckTimer,
  } = deps;

  return {
    // ── Send message ──

    sendMessage: async (...args: unknown[]) => {
      const options = normalizeSendMessageOptions(args);
      const {
        text,
        sessionKey: requestedSessionKey,
        attachments,
        targetAgentId,
        dingTalkMentions,
        workflowId: _workflowId,
        runId: _runId,
        workflowContext,
        embedBrowserContext,
        skillMeta,
      } = options;
      const userDisplayText = text.trim();
      const skillGatewayText = skillMeta
        ? resolveSkillGatewayText(resolveSkillFromPlaza(skillMeta.slug).defaultPrompt, userDisplayText)
        : userDisplayText;
      const gatewayText = skillMeta
        ? appendSkillTranscriptMarker(skillGatewayText, skillMeta, userDisplayText)
        : skillGatewayText;
      if (!gatewayText && (!attachments || attachments.length === 0) && !skillMeta) return;

      // DEFAULT_SESSION_KEY is a UI placeholder. Materialize it before target
      // resolution so a fresh home/project conversation always gets a unique
      // local key and, for projects, completes catalog binding + gateway reload
      // through the registered session-readiness promise before dispatch.
      if (!requestedSessionKey && get().currentSessionKey === DEFAULT_SESSION_KEY) {
        const pendingProjectId = get().pendingProjectId;
        get().newSession(
          pendingProjectId
            ? { projectId: pendingProjectId, materialize: true }
            : undefined,
        );
      }

      const {
        dingTalkRpcExtras,
        engineType: currentSessionEngineType,
        sessionKey: currentSessionKey,
      } = await resolveSendTarget({
        get,
        set,
        targetAgentId,
        dingTalkMentions,
        attachments,
        requestedSessionKey,
        resolveMainSessionKeyForAgent,
        buildSessionSwitchPatch,
        resolveEngineTypeForSession,
      });
      logChatFlow('send.target.resolved', {
        sessionKey: currentSessionKey,
        engineType: currentSessionEngineType,
        targetAgentId: targetAgentId ?? null,
        attachmentCount: attachments?.length ?? 0,
        hasDingTalkMentions: Boolean(dingTalkMentions?.length),
      });
      if (getSessionRuntimeState(get().runtimeBySessionKey, currentSessionKey).sending) {
        logChatFlow('send.blocked.active-runtime', { sessionKey: currentSessionKey });
        return;
      }

      if (!tryAcquireSendAttempt(currentSessionKey)) {
        logChatFlow('send.blocked.preparing-runtime', { sessionKey: currentSessionKey });
        return;
      }

      try {
      try {
        await awaitSessionSendReadiness(currentSessionKey);
      } catch (error) {
        const normalized = normalizeAppError(error);
        logChatFlow('send.blocked.session-not-ready', {
          sessionKey: currentSessionKey,
          error: normalized.message,
        });
        setRuntimePatch(set, currentSessionKey, { error: normalized.message });
        return;
      }

      const preparedContext = await prepareSendContext({
        trimmedText: gatewayText,
        memoryQueryText: userDisplayText || skillMeta?.title,
        sessionKey: currentSessionKey,
        messages: get().currentSessionKey === currentSessionKey ? get().messages : [],
        workflowCardStates: get().currentSessionKey === currentSessionKey ? get().workflowCardStates : {},
        workflowContext,
        embedBrowserContext,
        engineType: currentSessionEngineType,
        clearPendingWorkflow: get().clearPendingWorkflow,
      });
      const {
        claudeMemorySystemPrompt,
        messageWithContext,
      } = preparedContext;
      const displayText = skillMeta ? userDisplayText : preparedContext.displayText;
      logChatFlow('send.context.prepared', {
        sessionKey: currentSessionKey,
        engineType: currentSessionEngineType,
        displayLength: displayText.length,
        gatewayMessageLength: messageWithContext.length,
        hasSystemPromptAppend: Boolean(claudeMemorySystemPrompt),
        hasWorkflowContext: Boolean(workflowContext),
      });

      const userMsg = insertOptimisticUserTurn({
        get,
        set,
        sessionKey: currentSessionKey,
        displayText,
        gatewayMessage: messageWithContext,
        attachments,
        skillMeta,
      });
      const idempotencyKey = userMsg.id || crypto.randomUUID();
      setRuntimePatch(set, currentSessionKey, {
        sending: true,
        aborting: false,
        activeRunId: null,
        error: null,
        sendAcceptance: {
          idempotencyKey,
          status: 'pending',
          startedAt: Date.now(),
        },
      });
      logChatFlow('send.optimistic.inserted', {
        sessionKey: currentSessionKey,
        optimisticId: userMsg.id,
        displayLength: displayText.length,
        attachmentCount: attachments?.length ?? 0,
      });

      scheduleSendWatchdogs({
        get,
        set,
        sessionKey: currentSessionKey,
        clearErrorRecoveryTimer,
        clearHistoryPoll,
        setHistoryPollTimer,
        clearStuckCheckTimer,
        setStuckCheckTimer,
      });

      try {
        // Reuse the optimistic user message id as the idempotency key so the
        // Gateway can round-trip it back on the user message record (chat.history).
        // That lets isSameUserMessage pair the optimistic copy with its server echo
        // by id instead of falling back to text matching. Inert until the Gateway
        // echoes this id; harmless before then (still a unique UUID per send).
        const hasMedia = attachments && attachments.length > 0;

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          cacheUploadedAttachments(attachments);
        }

        const result = await dispatchChatRequest({
          sessionKey: currentSessionKey,
          message: hasMedia ? messageWithContext || '' : messageWithContext,
          idempotencyKey,
          systemPromptAppend: claudeMemorySystemPrompt,
          engineType: currentSessionEngineType,
          attachments: hasMedia ? attachments : undefined,
          extras: dingTalkRpcExtras,
          // NOTE: workflowId/runId are not forwarded to Gateway chat.send yet
          // because the Gateway schema does not accept them. Workflow state
          // is tracked via SSE + main process polling instead.
        });


        if (!result.success) {
          logChatFlow('send.dispatch.failed', {
            sessionKey: currentSessionKey,
            idempotencyKey,
            error: result.error ?? null,
          });
          failSendTurn({
            set,
            clearHistoryPoll,
            sessionKey: currentSessionKey,
            error: result.error || 'Failed to send message',
          });
        } else if (result.result?.runId) {
          logChatFlow('send.dispatch.accepted', {
            sessionKey: currentSessionKey,
            idempotencyKey,
            runId: result.result.runId,
          });
          setRuntimePatch(set, currentSessionKey, (runtime) => (
            runtime.sendAcceptance?.idempotencyKey === idempotencyKey
              ? {
                  sending: true,
                  activeRunId: result.result?.runId ?? null,
                  error: null,
                  sendAcceptance: { ...runtime.sendAcceptance, status: 'accepted' },
                }
              : {}
          ));
        }
      } catch (err) {
        const normalized = normalizeAppError(err);
        logChatFlow('send.dispatch.error', {
          sessionKey: currentSessionKey,
          error: normalized.message,
          code: normalized.code,
        });
        if (isUncertainDispatchError(normalized)) {
          setRuntimePatch(set, currentSessionKey, (runtime) => (
            buildUncertainAcceptancePatch(runtime, idempotencyKey)
          ));
        } else {
          failSendTurn({
            set,
            clearHistoryPoll,
            sessionKey: currentSessionKey,
            error: normalized.message,
          });
        }
      }
      } finally {
        releaseSendAttempt(currentSessionKey);
      }
    },

    // ── Abort active run ──

    abortRun: async (requestedSessionKey?: string) => {
      const sessionKey = requestedSessionKey?.trim() || get().currentSessionKey;
      const runtime = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey);
      if (!runtime.sending) return true;
      if (runtime.aborting) return false;
      const activeRunId = runtime.activeRunId;
      setRuntimePatch(set, sessionKey, { aborting: true, error: null });
      try {
        await useGatewayStore.getState().rpc(
          'chat.abort',
          {
            sessionKey,
            engineType: resolveEngineTypeForSession(
              get().sessions,
              sessionKey,
              getAgentIdFromSessionKey(sessionKey) ?? get().currentAgentId,
            ),
          },
        );
        const latestRuntime = getSessionRuntimeState(get().runtimeBySessionKey, sessionKey);
        // An aborted event may have already finalized this run and triggered the
        // next queued turn while the RPC acknowledgement was still in flight.
        if (activeRunId && latestRuntime.activeRunId && latestRuntime.activeRunId !== activeRunId) {
          return false;
        }
        if (!latestRuntime.aborting) {
          recordTerminalRun(sessionKey, activeRunId);
          return true;
        }
        discardAgentMemoriesForAbnormalTurn({
          sessionKey,
          runId: activeRunId,
          reason: 'aborted',
        });
        clearHistoryPoll(sessionKey);
        clearErrorRecoveryTimer(sessionKey);
        clearStuckCheckTimer(sessionKey);
        setRuntimePatch(set, sessionKey, buildTerminalRuntimePatch(null));
        recordTerminalRun(sessionKey, activeRunId);
        return true;
      } catch (err) {
        // The engine may still be running. Keep the run bound so subsequent
        // delta/final events remain valid and the user can retry stopping it.
        setRuntimePatch(set, sessionKey, (latestRuntime) => {
          if (!latestRuntime.aborting) return {};
          if (activeRunId && latestRuntime.activeRunId && latestRuntime.activeRunId !== activeRunId) return {};
          return { aborting: false, error: String(err) };
        });
        return false;
      }
    },

  };
}
