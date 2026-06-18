import { hostApiFetch } from '@/lib/host-api';
import { useAgentsStore } from '@/stores/agents';
import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  formatChatRuntimeError,
  getLastChatEventAt,
  setHistoryPollTimer,
  setLastChatEventAt,
  upsertImageCacheEntry,
} from './helpers';
import type { ChatSession, RawMessage } from './types';
import { buildDingTalkMentionRpcExtras } from '@/lib/dingtalk-mention-context';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

function logDingTalkMentionClient(message: string, data: unknown): void {
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data,
    }),
  }).catch(() => undefined);
}

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey }];
}

function getSessionEngineType(sessions: ChatSession[], sessionKey: string): ChatSession['engineType'] | undefined {
  return sessions.find((session) => session.key === sessionKey)?.engineType;
}

type TokenQuotaCheckResult = {
  success: boolean;
  data?: {
    allowed?: boolean;
    used_today?: number;
    limit?: number;
  };
};

export type DailyTokenQuotaState = {
  allowed?: boolean;
  used_today?: number;
  limit?: number;
};

function toNumberIfFinite(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

export async function checkDailyTokenQuota(): Promise<DailyTokenQuotaState | null> {
  try {
    const quotaCheck = await hostApiFetch<TokenQuotaCheckResult>('/api/token-quota/check');
    if (!quotaCheck?.success || !quotaCheck.data) return null;
    return quotaCheck.data;
  } catch {
    return null;
  }
}

export function formatQuotaExceededMessage(usedToday?: number, limit?: number): string {
  if (typeof usedToday === 'number' && typeof limit === 'number') {
    return `Daily token quota exceeded (${usedToday}/${limit}).`;
  }
  return 'Daily token quota exceeded.';
}

export function createRuntimeSendActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'sendMessage' | 'abortRun'> {
  return {
    sendMessage: async (
      options: import('@/stores/chat/types').SendMessageOptions,
    ) => {
      const { text, attachments, targetAgentId, dingTalkMentions, workflowId: _workflowId, runId: _runId } = options;
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      const dingTalkRpcExtras = buildDingTalkMentionRpcExtras(
        dingTalkMentions,
        attachments?.map((file) => ({
          fileName: file.fileName,
          filePath: file.stagedPath,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
        })),
      );
      console.info('[dingtalk-mention] runtime-send: rpc extras', {
        mentionCount: dingTalkMentions?.length ?? 0,
        mentions: dingTalkMentions?.map((mention) => ({
          type: mention.type,
          displayName: mention.displayName,
          hasUserId: Boolean(mention.userId),
          hasOpenConversationId: Boolean(mention.openConversationId),
          hasCorpId: Boolean(mention.corpId),
        })) ?? [],
        attachmentCount: attachments?.length ?? 0,
        hasRpcExtras: Boolean(dingTalkRpcExtras),
        rpcExtraKeys: dingTalkRpcExtras ? Object.keys(dingTalkRpcExtras) : [],
      });
      logDingTalkMentionClient('[dingtalk-mention] runtime-send: rpc extras', {
        mentionCount: dingTalkMentions?.length ?? 0,
        mentions: dingTalkMentions?.map((mention) => ({
          type: mention.type,
          displayName: mention.displayName,
          hasUserId: Boolean(mention.userId),
          hasOpenConversationId: Boolean(mention.openConversationId),
          hasCorpId: Boolean(mention.corpId),
        })) ?? [],
        targetAgentId: targetAgentId ?? null,
        attachmentCount: attachments?.length ?? 0,
        hasRpcExtras: Boolean(dingTalkRpcExtras),
        rpcExtraKeys: dingTalkRpcExtras ? Object.keys(dingTalkRpcExtras) : [],
      });

      const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;
      if (targetSessionKey !== get().currentSessionKey) {
        const current = get();
        const leavingEmpty = !current.currentSessionKey.endsWith(':main') && current.messages.length === 0;
        set((s) => ({
          currentSessionKey: targetSessionKey,
          currentAgentId: getAgentIdFromSessionKey(targetSessionKey),
          sessions: ensureSessionEntry(
            leavingEmpty ? s.sessions.filter((session) => session.key !== current.currentSessionKey) : s.sessions,
            targetSessionKey,
          ),
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLastActivity,
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
        }));
        await get().loadHistory(true);
      }

      const currentSessionKey = targetSessionKey;
      const currentSessionEngineType = getSessionEngineType(get().sessions, currentSessionKey);

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
        return;
      }

      // Add user message optimistically (with local file metadata for UI display)
      const nowMs = Date.now();
      const userMsg: RawMessage = {
        role: 'user',
        content: trimmed || (attachments?.length ? '(file attached)' : ''),
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
      set((s) => ({
        messages: [...s.messages, userMsg],
        sending: true,
        error: null,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: nowMs,
      }));

      // Update session label with first user message text as soon as it's sent
      const { sessionLabels, messages } = get();
      const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
      if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && trimmed) {
        const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
        set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
      }

      // Mark this session as most recently active
      set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

      // Start the history poll and safety timeout IMMEDIATELY (before the
      // RPC await) because the gateway's chat.send RPC may block until the
      // entire agentic conversation finishes — the poll must run in parallel.
      setLastChatEventAt(Date.now());
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
        });
      };
      setTimeout(checkStuck, 30_000);

      try {
        const idempotencyKey = crypto.randomUUID();
        const hasMedia = attachments && attachments.length > 0;

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          for (const a of attachments) {
            upsertImageCacheEntry(a.stagedPath, {
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
              preview: a.preview,
            });
          }
        }

        let result: { success: boolean; result?: { runId?: string }; error?: string };

        if (hasMedia) {
          result = await hostApiFetch(
            '/api/chat/send-with-media',
            {
              method: 'POST',
              body: JSON.stringify({
                sessionKey: currentSessionKey,
                message: trimmed || '',
                deliver: false,
                idempotencyKey,
                engineType: currentSessionEngineType,
                media: attachments.map((a) => ({
                  filePath: a.stagedPath,
                  mimeType: a.mimeType,
                  fileName: a.fileName,
                })),
                ...dingTalkRpcExtras,
              }),
            },
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        } else {
          result = await hostApiFetch(
            '/api/chat/send',
            {
              method: 'POST',
              body: JSON.stringify({
                sessionKey: currentSessionKey,
                message: trimmed,
                deliver: false,
                idempotencyKey,
                engineType: currentSessionEngineType,
                ...dingTalkRpcExtras,
              }),
            },
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        }

        
        if (!result.success) {
          clearHistoryPoll();
          set((s) => ({
            messages: s.messages.map((message, index, arr) => (
              index === arr.length - 1 && message.role === 'user'
                ? { ...message, isError: true }
                : message
            )),
            error: formatChatRuntimeError(result.error || 'Failed to send message'),
            sending: false,
            activeRunId: null,
            pendingFinal: false,
          }));
        } else if (result.result?.runId) {
          set({ activeRunId: result.result.runId });
        }
      } catch (err) {
        clearHistoryPoll();
        set((s) => ({
          messages: s.messages.map((message, index, arr) => (
            index === arr.length - 1 && message.role === 'user'
              ? { ...message, isError: true }
              : message
          )),
          error: formatChatRuntimeError(String(err)),
          sending: false,
          activeRunId: null,
          pendingFinal: false,
        }));
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey } = get();
      set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null, pendingToolImages: [] });
      set({ streamingTools: [] });

      try {
        await hostApiFetch<{ success?: boolean; error?: string }>('/api/chat/abort', {
          method: 'POST',
          body: JSON.stringify({
            sessionKey: currentSessionKey,
            engineType: getSessionEngineType(get().sessions, currentSessionKey),
          }),
        });
      } catch (err) {
        set({ error: String(err) });
      }
    },

    // ── Handle incoming chat events from Gateway ──

  };
}
