import { cacheUploadedAttachments } from './media-preview-cache';
import { dispatchChatRequest } from './dispatch-chat-request';
import { insertOptimisticUserTurn } from './optimistic-turn';
import { prepareSendContext } from './prepare-send-context';
import { resolveSendTarget } from './resolve-send-target';
import { logChatFlow, logUserQuestion } from './chat-flow-log';
import { useGatewayStore } from '../gateway';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { DEFAULT_SESSION_KEY, type ChatSession, type SendMessageOptions } from './types';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { resolveSkillPrompt } from '@/lib/skill-plaza-resolve';
import { resolveSkillGatewayText } from '@/lib/skill-gateway-text';
import { appendSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import { awaitSessionSendReadiness } from '@/lib/session-send-readiness';
import { releaseSendAttempt, tryAcquireSendAttempt } from './send-attempt-lock';
import { getAgentIdFromSessionKey } from './session-identity';
import { initializeChatRuntimeV2, useChatRuntimeV2Store } from './runtime-v2-store';
import { buildChatSessionRuntimeView } from './runtime-selectors';
import { getSessionDisplayMessages } from './display-selectors';

export function isUncertainDispatchError(error: unknown): boolean {
  const code = normalizeAppError(error).code;
  return code === 'TIMEOUT' || code === 'NETWORK';
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
  } = deps;

  return {
    // ── Send message ──

    sendMessage: async (...args: unknown[]) => {
      await initializeChatRuntimeV2();
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
        skillMetas,
        gatewayText: preBakedGatewayText,
        composerSegments,
      } = options;
      const userDisplayText = text.trim();
      /** 正式坐标：skillMetas；skillMeta 仅 deprecated 兼容派生 */
      const resolvedSkillMetas = skillMetas ?? (skillMeta ? [skillMeta] : []);
      const primarySkillMeta = resolvedSkillMetas[0];
      if (
        resolvedSkillMetas.length === 0
        && !userDisplayText
        && (!attachments || attachments.length === 0)
      ) {
        return;
      }

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
      if (buildChatSessionRuntimeView(
        useChatRuntimeV2Store.getState().sessionsByKey[currentSessionKey],
      ).sending) {
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
        return;
      }

      let gatewayText = preBakedGatewayText?.trim();
      if (!gatewayText) {
        if (primarySkillMeta) {
          gatewayText = appendSkillTranscriptMarker(
            resolveSkillGatewayText(
              (await resolveSkillPrompt(primarySkillMeta.slug)).defaultPrompt,
              userDisplayText,
            ),
            primarySkillMeta,
            userDisplayText,
          );
        } else {
          gatewayText = userDisplayText;
        }
      }

      const preparedContext = await prepareSendContext({
        trimmedText: gatewayText,
        sessionKey: currentSessionKey,
        messages: get().currentSessionKey === currentSessionKey ? getSessionDisplayMessages(currentSessionKey) : [],
        workflowContext,
        embedBrowserContext,
        clearPendingWorkflow: get().clearPendingWorkflow,
      });
      const { messageWithContext } = preparedContext;
      const displayText = preBakedGatewayText || resolvedSkillMetas.length
        ? userDisplayText
        : preparedContext.displayText;
      logChatFlow('send.context.prepared', {
        sessionKey: currentSessionKey,
        engineType: currentSessionEngineType,
        displayLength: displayText.length,
        gatewayMessageLength: messageWithContext.length,
        hasSystemPromptAppend: false,
        hasWorkflowContext: Boolean(workflowContext),
      });

      const userMsg = insertOptimisticUserTurn({
        get,
        set,
        sessionKey: currentSessionKey,
        displayText,
        gatewayMessage: messageWithContext,
        attachments,
        skillMeta: primarySkillMeta,
        skillMetas: resolvedSkillMetas.length ? resolvedSkillMetas : undefined,
        composerSegments,
      });
      const idempotencyKey = userMsg.id || crypto.randomUUID();
      logUserQuestion('send-optimistic-inserted', {
        sessionKey: currentSessionKey,
        optimisticId: userMsg.id,
        displayText,
        gatewayText: messageWithContext,
        displayLength: displayText.length,
        gatewayLength: messageWithContext.length,
        attachmentCount: attachments?.length ?? 0,
        skillMetas: resolvedSkillMetas,
        composerSegmentCount: composerSegments?.length ?? 0,
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
          sourceText: userDisplayText || primarySkillMeta?.title,
          idempotencyKey,
          engineType: currentSessionEngineType,
          attachments: hasMedia ? attachments : undefined,
          extras: dingTalkRpcExtras,
          // NOTE: workflowId/runId are not forwarded to Gateway chat.send yet
          // because the Gateway schema does not accept them. Workflow state
          // is tracked via SSE + main process polling instead.
        });


        if (!result.success) {
          if (result.error?.startsWith('CHAT_RUNTIME_UNAVAILABLE')) {
            useChatRuntimeV2Store.getState().setError(
              currentSessionKey,
              new AppError('GATEWAY', '发送状态暂不可确认，请稍后使用原消息重试。'),
            );
          }
          logChatFlow('send.dispatch.failed', {
            sessionKey: currentSessionKey,
            idempotencyKey,
            error: result.error ?? null,
          });
        } else if (result.result?.runId) {
          logChatFlow('send.dispatch.accepted', {
            sessionKey: currentSessionKey,
            idempotencyKey,
            runId: result.result.runId,
          });
        }
      } catch (err) {
        const normalized = normalizeAppError(err);
        logChatFlow('send.dispatch.error', {
          sessionKey: currentSessionKey,
          error: normalized.message,
          code: normalized.code,
        });
        // Main's supervisor owns uncertain/failed dispatch transitions and
        // broadcasts the canonical snapshot used by the Renderer.
      }
      } finally {
        releaseSendAttempt(currentSessionKey);
      }
    },

    // ── Abort active run ──

    abortRun: async (requestedSessionKey?: string) => {
      const sessionKey = requestedSessionKey?.trim() || get().currentSessionKey;
      const runtime = buildChatSessionRuntimeView(
        useChatRuntimeV2Store.getState().sessionsByKey[sessionKey],
      );
      if (!runtime.sending) return true;
      try {
        const result = await useGatewayStore.getState().rpc<{
          aborted?: boolean;
          runIds?: unknown[];
        }>(
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
        if (result?.aborted === false && Array.isArray(result.runIds) && result.runIds.length === 0) {
          await useChatRuntimeV2Store.getState().hydrate(sessionKey);
        }
        return true;
      } catch {
        return false;
      }
    },

  };
}
