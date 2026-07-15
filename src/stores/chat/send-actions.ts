import { cacheUploadedAttachments } from './media-preview-cache';
import { setRuntimePatch } from './runtime-controller';
import { dispatchChatRequest } from './dispatch-chat-request';
import { insertOptimisticUserTurn } from './optimistic-turn';
import { prepareSendContext } from './prepare-send-context';
import { resolveSendTarget } from './resolve-send-target';
import { ensureDailyTokenQuota } from './send-quota';
import { scheduleSendWatchdogs } from './send-watchdogs';
import { logChatFlow } from './chat-flow-log';
import { useGatewayStore } from '../gateway';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import type { ChatSession, SendMessageOptions } from './types';

function failSendTurn(input: {
  set: ChatSet;
  clearHistoryPoll: () => void;
  sessionKey: string;
  error: string;
}): void {
  input.clearHistoryPoll();
  setRuntimePatch(input.set, input.sessionKey, {
    sending: false,
    activeRunId: null,
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
  toNumberIfFinite: (value: unknown) => number | undefined;
  clearErrorRecoveryTimer: () => void;
  clearHistoryPoll: () => void;
  setHistoryPollTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
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
    toNumberIfFinite,
    clearErrorRecoveryTimer,
    clearHistoryPoll,
    setHistoryPollTimer,
  } = deps;

  return {
    // ── Send message ──

    sendMessage: async (...args: unknown[]) => {
      const options = normalizeSendMessageOptions(args);
      const {
        text,
        attachments,
        targetAgentId,
        dingTalkMentions,
        workflowId: _workflowId,
        runId: _runId,
        workflowContext,
        embedBrowserContext,
      } = options;
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

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

      const {
        claudeMemorySystemPrompt,
        displayText,
        messageWithContext,
      } = await prepareSendContext({
        trimmedText: trimmed,
        sessionKey: currentSessionKey,
        messages: get().messages,
        workflowCardStates: get().workflowCardStates,
        workflowContext,
        embedBrowserContext,
        engineType: currentSessionEngineType,
        agentId: targetAgentId ?? get().currentAgentId,
        clearPendingWorkflow: get().clearPendingWorkflow,
      });
      logChatFlow('send.context.prepared', {
        sessionKey: currentSessionKey,
        engineType: currentSessionEngineType,
        displayLength: displayText.length,
        gatewayMessageLength: messageWithContext.length,
        hasSystemPromptAppend: Boolean(claudeMemorySystemPrompt),
        hasWorkflowContext: Boolean(workflowContext),
      });

      const quotaAllowed = await ensureDailyTokenQuota({
        set,
        sessionKey: currentSessionKey,
        toNumberIfFinite,
      });
      if (!quotaAllowed) {
        logChatFlow('send.quota.blocked', {
          sessionKey: currentSessionKey,
        });
        return;
      }
      logChatFlow('send.quota.allowed', {
        sessionKey: currentSessionKey,
      });

      const userMsg = insertOptimisticUserTurn({
        get,
        set,
        sessionKey: currentSessionKey,
        displayText,
        gatewayMessage: messageWithContext,
        attachments,
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
      });

      try {
        // Reuse the optimistic user message id as the idempotency key so the
        // Gateway can round-trip it back on the user message record (chat.history).
        // That lets isSameUserMessage pair the optimistic copy with its server echo
        // by id instead of falling back to text matching. Inert until the Gateway
        // echoes this id; harmless before then (still a unique UUID per send).
        const idempotencyKey = userMsg.id || crypto.randomUUID();
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
          setRuntimePatch(set, currentSessionKey, {
            sending: true,
            activeRunId: result.result?.runId ?? null,
            error: null,
          });
        }
      } catch (err) {
        logChatFlow('send.dispatch.error', {
          sessionKey: currentSessionKey,
          error: String(err),
        });
        failSendTurn({
          set,
          clearHistoryPoll,
          sessionKey: currentSessionKey,
          error: String(err),
        });
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey } = get();
      setRuntimePatch(set, currentSessionKey, {
        sending: false,
        activeRunId: null,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: null,
        optimisticUserMessage: null,
        pendingToolImages: [],
      });

      try {
        await useGatewayStore.getState().rpc(
          'chat.abort',
          {
            sessionKey: currentSessionKey,
            engineType: resolveEngineTypeForSession(get().sessions, currentSessionKey, get().currentAgentId),
          },
        );
      } catch (err) {
        setRuntimePatch(set, currentSessionKey, { error: String(err) });
      }
    },

  };
}
