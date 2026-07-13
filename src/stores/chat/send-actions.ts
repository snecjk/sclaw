import { hostApiFetch } from '@/lib/host-api';
import { checkDailyTokenQuota, formatQuotaExceededMessage } from './runtime-send-actions';
import { buildDingTalkMentionRpcExtras } from '@/lib/dingtalk-mention-context';
import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import { traceChatSession } from '../../../shared/chat-session-trace';
import { dedupeRedundantUserMessages } from './user-message-merge';
import { normalizeDerivedSessionLabel, isCorruptedSessionLabel } from '@/lib/workflow-session-hint';
import { shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import { getLastChatEventAt } from './helpers';
import { cacheUploadedAttachments } from './media-preview-cache';
import { patchSessionRuntimeState } from './session-runtime';
import { touchLastChatEventAt } from './history-finalization';
import { useGatewayStore } from '../gateway';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import type { ChatSession, RawMessage, SendMessageOptions } from './types';

const HISTORY_POLL_SILENCE_WINDOW_MS = 2_500;

export interface SendActionsDeps {
  normalizeSendMessageOptions: (args: unknown[]) => SendMessageOptions;
  resolveMainSessionKeyForAgent: (agentId: string | undefined | null) => string | null;
  buildSessionSwitchPatch: (state: ReturnType<ChatGet>, nextSessionKey: string) => Partial<ReturnType<ChatGet>>;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
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
      const { text, attachments, targetAgentId, dingTalkMentions, workflowId: _workflowId, runId: _runId, workflowContext } = options;
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      // Inject hidden workflow context / session hint for AI guidance
      const {
        appendAgentMemoryContextBlock,
      } = await import('@/lib/agent-memory');
      const {
        appendAgentExecutionMemoryContext,
        rememberInjectedExecutionMemories,
      } = await import('@/lib/agent-execution-memory');
      const { buildAgentMemoryContextBlocks } = await import('@/lib/agent-memory-context');
      const { appendWorkflowContext, stripWorkflowContextForDisplay } = await import('@/lib/workflow-context');
      const {
        buildWorkflowSessionHint,
        buildWorkflowCreationHint,
        appendWorkflowSessionHint,
        stripWorkflowSessionHintForDisplay,
      } = await import('@/lib/workflow-session-hint');

      const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;

      if (targetSessionKey !== get().currentSessionKey) {
        set((s) => buildSessionSwitchPatch(s, targetSessionKey));
        await get().loadHistory(true);
      }

      const currentSessionKey = targetSessionKey;
      const currentSessionEngineType = resolveEngineTypeForSession(
        get().sessions,
        currentSessionKey,
        targetAgentId ?? get().currentAgentId,
      );
      const dingTalkRpcExtras = buildDingTalkMentionRpcExtras(
        dingTalkMentions,
        attachments?.map((file) => ({
          fileName: file.fileName,
          filePath: file.stagedPath,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
        })),
      );

      let textForGateway = trimmed;
      if (!workflowContext) {
        const {
          shouldInjectWorkflowSessionHint,
          isWorkflowCreationIntent,
        } = await import('@/hooks/use-workflow-intent');
        if (shouldInjectWorkflowSessionHint(trimmed)) {
          const hint = buildWorkflowSessionHint(
            currentSessionKey,
            get().messages,
            get().workflowCardStates,
          );
          textForGateway = appendWorkflowSessionHint(trimmed, hint);
        } else if (isWorkflowCreationIntent(trimmed)) {
          get().clearPendingWorkflow();
          let creationHint = buildWorkflowCreationHint(trimmed);
          try {
            const { searchWorkflowTemplates } = await import('@/lib/workflow-api');
            const { extractWorkflowSearchQuery } = await import('@/lib/workflow-session-hint');
            const searchResult = await searchWorkflowTemplates(extractWorkflowSearchQuery(trimmed), 5);
            if (searchResult.matchedItems.length > 0) {
              creationHint = buildWorkflowCreationHint(trimmed, searchResult.matchedItems);
            }
          } catch (err) {
            console.warn('[workflow-trace] creation hint pre-search failed:', err);
          }
          textForGateway = appendWorkflowSessionHint(trimmed, creationHint);
        }
      }

      // 一次 mem0 检索同时取「偏好」+「执行经验」两类记忆，按 memoryScope 路由到各自 block，
      // 替代原先偏好/执行各查一次的两次检索。统一跨 run（仅 agentId）：执行经验需跨 run 复用，
      // 偏好随之也跨 run（由相关性排序取 top）。
      const memoryBlocks = await buildAgentMemoryContextBlocks(trimmed, {
        agentId: targetAgentId ?? get().currentAgentId,
      });
      rememberInjectedExecutionMemories(currentSessionKey, memoryBlocks.injectedExecutionMemories);
      const claudeMemorySystemPrompt = currentSessionEngineType === 'claude'
        ? [memoryBlocks.preference, memoryBlocks.execution]
            .filter((context): context is string => Boolean(context))
            .join('\n\n') || undefined
        : undefined;
      if (currentSessionEngineType !== 'claude') {
        textForGateway = appendAgentMemoryContextBlock(textForGateway, memoryBlocks.preference);
        textForGateway = appendAgentExecutionMemoryContext(textForGateway, memoryBlocks.execution);
      }

      const messageWithContext = appendWorkflowContext(textForGateway, workflowContext);

      console.info('[chat-message]\n', messageWithContext);

      const displayText = stripWorkflowSessionHintForDisplay(
        stripAgentMemoryContextsForDisplay(
          stripWorkflowContextForDisplay(messageWithContext),
        ),
      );

      const quotaCheck = await checkDailyTokenQuota();
      if (quotaCheck) {
        set({
          dailyTokenQuotaStatus: {
            allowed: quotaCheck.allowed,
            usedToday: toNumberIfFinite(quotaCheck.used_today),
            limit: toNumberIfFinite(quotaCheck.limit),
            checkedAt: new Date().toISOString(),
          },
        });
      }
      if (quotaCheck && quotaCheck.allowed === false) {
        set({
          error: formatQuotaExceededMessage(quotaCheck.used_today, quotaCheck.limit),
          sending: false,
        });
        set((s) => patchSessionRuntimeState(s, currentSessionKey, {
          sending: false,
          error: formatQuotaExceededMessage(quotaCheck.used_today, quotaCheck.limit),
        }));
        return;
      }

      // Add user message optimistically (with local file metadata for UI display)
      const nowMs = Date.now();
      const userMsg: RawMessage = {
        role: 'user',
        content: displayText || (attachments?.length ? '(file attached)' : ''),
        timestamp: nowMs / 1000,
        id: crypto.randomUUID(),
        _attachedFiles: attachments?.map(a => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          preview: a.preview,
          filePath: a.stagedPath,
        })),
      };
      traceChatSession({
        phase: 'merge-optimistic',
        action: 'optimistic-insert',
        sessionKey: currentSessionKey,
        userMessageAt: nowMs,
        sending: true,
        optimisticId: userMsg.id,
        reason: 'sendMessage',
        detail: {
          displayLen: displayText.length,
          gatewayLen: messageWithContext.length,
          idempotencyKey: userMsg.id,
        },
      });
      set((s) => ({
        messages: dedupeRedundantUserMessages([...s.messages, userMsg], nowMs, {
          sessionKey: currentSessionKey,
        }),
        sending: true,
        error: null,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: nowMs,
        optimisticUserMessage: userMsg,
      }));
      set((s) => patchSessionRuntimeState(s, currentSessionKey, {
        sending: true,
        activeRunId: null,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: nowMs,
        optimisticUserMessage: userMsg,
        pendingToolImages: [],
        error: null,
      }));

      // Update session label with first user message text as soon as it's sent
      const { sessionLabels, messages } = get();
      const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
      if (!currentSessionKey.endsWith(':main') && isFirstMessage
        && shouldAutoDeriveSessionLabel(currentSessionKey, sessionLabels, isCorruptedSessionLabel)
        && displayText) {
        const normalized = normalizeDerivedSessionLabel(displayText);
        if (normalized) {
          set((s) => ({
            sessionLabels: {
              ...s.sessionLabels,
              [currentSessionKey]: normalized,
            },
          }));
        }
      }

      // Mark this session as most recently active
      set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

      // Start the history poll and safety timeout IMMEDIATELY (before the
      // RPC await) because the gateway's chat.send RPC may block until the
      // entire agentic conversation finishes — the poll must run in parallel.
      touchLastChatEventAt(set);
      clearHistoryPoll();
      clearErrorRecoveryTimer();

      const POLL_START_DELAY = 3_000;
      const POLL_INTERVAL = 4_000;
      const pollHistory = () => {
        const state = get();
        if (!state.sending) { clearHistoryPoll(); return; }
        if (state.streamingMessage) {
          setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
          return;
        }
        if (Date.now() - getLastChatEventAt() < HISTORY_POLL_SILENCE_WINDOW_MS) {
          setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
          return;
        }
        state.loadHistory(true);
        setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
      };
      setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY));

      const SAFETY_TIMEOUT_MS = 90_000;
      const checkStuck = () => {
        const state = get();
        if (!state.sending) return;
        if (state.streamingMessage || state.streamingText) return;
        if (state.pendingFinal) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        clearHistoryPoll();
        set({
          error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
          optimisticUserMessage: null,
        });
        set((s) => patchSessionRuntimeState(s, currentSessionKey, {
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
          error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
        }));
      };
      setTimeout(checkStuck, 30_000);

      try {
        // Reuse the optimistic user message id as the idempotency key so the
        // Gateway can round-trip it back on the user message record (chat.history).
        // That lets isSameUserMessage pair the optimistic copy with its server echo
        // by id instead of falling back to text matching. Inert until the Gateway
        // echoes this id; harmless before then (still a unique UUID per send).
        const idempotencyKey = userMsg.id;
        const hasMedia = attachments && attachments.length > 0;

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          cacheUploadedAttachments(attachments);
        }

        let result: { success: boolean; result?: { runId?: string }; error?: string };

        if (hasMedia) {
          result = await hostApiFetch<{ success: boolean; result?: { runId?: string }; error?: string }>(
            '/api/chat/send-with-media',
            {
              method: 'POST',
              body: JSON.stringify({
                sessionKey: currentSessionKey,
                // message: messageWithContext || 'Process the attached file(s).',
                message: messageWithContext || '',
                deliver: false,
                idempotencyKey,
                systemPromptAppend: claudeMemorySystemPrompt,
                engineType: currentSessionEngineType,
                media: attachments.map((a) => ({
                  filePath: a.stagedPath,
                  mimeType: a.mimeType,
                  fileName: a.fileName,
                })),
                ...dingTalkRpcExtras,
              }),
            },
          );
        } else {
          const rpcResult = await useGatewayStore.getState().rpc<{ runId?: string }>(
            'chat.send',
            {
              sessionKey: currentSessionKey,
              message: messageWithContext,
              deliver: false,
              idempotencyKey,
              systemPromptAppend: claudeMemorySystemPrompt,
              engineType: currentSessionEngineType,
              ...dingTalkRpcExtras,
              // NOTE: workflowId/runId are not forwarded to Gateway chat.send yet
              // because the Gateway schema does not accept them. Workflow state
              // is tracked via SSE + main process polling instead.
            },
          );
          result = { success: true, result: rpcResult };
        }


        if (!result.success) {
          clearHistoryPoll();
          set({ error: result.error || 'Failed to send message', sending: false, activeRunId: null, pendingFinal: false });
          set((s) => patchSessionRuntimeState(s, currentSessionKey, {
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            error: result.error || 'Failed to send message',
          }));
        } else if (result.result?.runId) {
          set({ activeRunId: result.result.runId });
          set((s) => patchSessionRuntimeState(s, currentSessionKey, {
            sending: true,
            activeRunId: result.result?.runId ?? null,
            error: null,
          }));
        }
      } catch (err) {
        clearHistoryPoll();
        set({ error: String(err), sending: false, activeRunId: null, pendingFinal: false });
        set((s) => patchSessionRuntimeState(s, currentSessionKey, {
          sending: false,
          activeRunId: null,
          pendingFinal: false,
          error: String(err),
        }));
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey } = get();
      set({
        sending: false,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        pendingFinal: false,
        lastUserMessageAt: null,
        optimisticUserMessage: null,
        pendingToolImages: [],
      });
      set({ streamingTools: [] });
      set((s) => patchSessionRuntimeState(s, currentSessionKey, {
        sending: false,
        activeRunId: null,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
      }));

      try {
        await useGatewayStore.getState().rpc(
          'chat.abort',
          {
            sessionKey: currentSessionKey,
            engineType: resolveEngineTypeForSession(get().sessions, currentSessionKey, get().currentAgentId),
          },
        );
      } catch (err) {
        set({ error: String(err) });
      }
    },

  };
}
