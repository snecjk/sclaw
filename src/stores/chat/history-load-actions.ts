import { toast } from 'sonner';
import { useGatewayStore } from '../gateway';
import { CHAT_HISTORY_LIMIT, CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import {
  isCronDatedSessionKey,
  isCronSessionKey,
  isVirtualTaskSessionKey,
  isClaudeScheduledTaskDatedSessionKey,
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
} from './cron-session-utils';
import {
  loadClaudeScheduledTaskFallbackMessages,
  loadCronFallbackMessages,
  loadVirtualTaskFallbackMessages,
} from './virtual-task-history';
import {
  applyLoadedHistorySnapshot,
  prepareHistoryToolEffects,
} from './history-apply-loaded';
import { mergeHistoryMessageSources } from './history-merge';
import { logChatFlow } from './chat-flow-log';
import type { ChatGet, ChatSet, HistoryActions } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { applyRuntimePatch } from './runtime-controller';
import { getSessionRuntimeState } from './session-runtime';
import { buildTerminalRuntimePatch } from './turn-state-machine';
import { clearSessionRuntimeTimers } from './runtime-timers';

const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const _historyLoadInFlight = new Map<string, Promise<void>>();
const _lastHistoryLoadAtBySession = new Map<string, number>();

export interface HistoryLoadDeps {
  toMs: (ts: unknown) => number;
  clearHistoryPoll: (sessionKey: string) => void;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
  stripAgentMemoryFromHistoryMessage: (message: RawMessage) => RawMessage;
  dispatchAgentMemoryCapture: (input: {
    agentId?: string | null;
    runId?: string | null;
    sessionKey?: string | null;
    engineType?: ChatSession['engineType'];
  }) => void;
}

async function loadFallbackMessagesForSession(sessionKey: string): Promise<RawMessage[]> {
  if (isVirtualTaskSessionKey(sessionKey)) {
    return loadVirtualTaskFallbackMessages(sessionKey, CHAT_HISTORY_LIMIT);
  }
  if (isCronSessionKey(sessionKey) || isCronDatedSessionKey(sessionKey)) {
    return loadCronFallbackMessages(sessionKey, CHAT_HISTORY_LIMIT);
  }
  if (
    isClaudeScheduledTaskSessionKey(sessionKey)
    || isClaudeScheduledTaskRunSessionKey(sessionKey)
    || isClaudeScheduledTaskDatedSessionKey(sessionKey)
  ) {
    return loadClaudeScheduledTaskFallbackMessages(sessionKey, CHAT_HISTORY_LIMIT);
  }
  return [];
}

async function mergeFallbackHistoryIfNeeded(
  sessionKey: string,
  allMessages: RawMessage[],
): Promise<RawMessage[]> {
  if (isVirtualTaskSessionKey(sessionKey)) {
    const fallbackMessages = await loadFallbackMessagesForSession(sessionKey);
    return fallbackMessages.length > 0
      ? mergeHistoryMessageSources([fallbackMessages, allMessages])
      : allMessages;
  }
  if (allMessages.length > 0) return allMessages;

  return loadFallbackMessagesForSession(sessionKey);
}

export function createHistoryLoadActions(
  set: ChatSet,
  get: ChatGet,
  deps: HistoryLoadDeps,
): HistoryActions {
  const {
    resolveEngineTypeForSession,
  } = deps;

  return {
    // ── Load chat history ──

    loadHistory: async (quiet = false, force = false, requestedSessionKey?: string) => {
      const targetSessionKey = requestedSessionKey ?? get().currentSessionKey;
      const existingLoad = _historyLoadInFlight.get(targetSessionKey);
      if (existingLoad) {
        await existingLoad;
        if (!requestedSessionKey && get().currentSessionKey !== targetSessionKey) {
          return get().loadHistory(quiet, force);
        }
        return;
      }

      const lastLoadAt = _lastHistoryLoadAtBySession.get(targetSessionKey) || 0;
      if (quiet && !force && Date.now() - lastLoadAt < HISTORY_LOAD_MIN_INTERVAL_MS) {
        return;
      }

      if (!quiet) set({ loading: true, error: null });
      logChatFlow('history.load.start', {
        sessionKey: targetSessionKey,
        quiet,
        force,
      });

      // 安全保护：如果历史记录加载花费太多时间，则强制将 loading 设置为 false
      // 防止 UI 永远卡在转圈状态。
      let loadingTimedOut = false;
      const loadingSafetyTimer = quiet ? null : setTimeout(() => {
        loadingTimedOut = true;
        set({ loading: false });
      }, 15_000);

      const loadPromise = (async () => {
        const applyHistorySnapshot = (
          rawMessages: RawMessage[],
          thinkingLevel: string | null,
          runtimeState?: { isRunning?: boolean; runtimeResult?: unknown },
        ) => {
          applyLoadedHistorySnapshot({
            get,
            set,
            deps,
            targetSessionKey,
            rawMessages,
            thinkingLevel,
            runtimeState,
          });
        };

        try {
          // Gateway chat.history does not support offset; load up to the hard max in one call.
          let thinkingLevel: string | null = null;
          const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
            'chat.history',
            {
              sessionKey: targetSessionKey,
              limit: CHAT_HISTORY_LENGTH_MAX_LIMIT,
              engineType: resolveEngineTypeForSession(get().sessions, targetSessionKey, get().currentAgentId),
            },
          );

          const allMessages: RawMessage[] = Array.isArray(data.messages)
            ? data.messages as RawMessage[]
            : [];
          const runtime = getSessionRuntimeState(get().runtimeBySessionKey, targetSessionKey);
          const idempotencyKey = runtime.sendAcceptance?.idempotencyKey;
          const hasServerEcho = Boolean(idempotencyKey && allMessages.some((message) => message.id === idempotencyKey));
          if (hasServerEcho) {
            const isBackgroundSession = get().currentSessionKey !== targetSessionKey;
            if (isBackgroundSession && data.isRunning === false) {
              clearSessionRuntimeTimers(targetSessionKey);
              set((state) => applyRuntimePatch(state, targetSessionKey, buildTerminalRuntimePatch(null)));
            } else {
              set((state) => applyRuntimePatch(state, targetSessionKey, (currentRuntime) => {
                if (!currentRuntime.sendAcceptance || currentRuntime.sendAcceptance.idempotencyKey !== idempotencyKey) {
                  return {};
                }
                return {
                  sendAcceptance: { ...currentRuntime.sendAcceptance, status: 'accepted' },
                };
              }));
            }
          }
          if (get().currentSessionKey !== targetSessionKey) return;
          if (data.thinkingLevel) {
            thinkingLevel = String(data.thinkingLevel);
          }

          if (allMessages.length >= CHAT_HISTORY_LENGTH_MAX_LIMIT) {
            toast.info('会话消息已达上限', {
              description: '当前会话历史记录较多，建议开启新会话以获得更好的体验。',
              duration: 5000,
            });
          }

          const rawMessages = await mergeFallbackHistoryIfNeeded(targetSessionKey, allMessages);
          logChatFlow('history.load.fetched', {
            sessionKey: targetSessionKey,
            rawCount: rawMessages.length,
            gatewayCount: allMessages.length,
            thinkingLevel,
            isRunning: typeof data.isRunning === 'boolean' ? data.isRunning : null,
          });

          if (get().currentSessionKey !== targetSessionKey) return;
          const canApply = await prepareHistoryToolEffects({
            rawMessages,
            sessionKey: targetSessionKey,
            agentId: get().currentAgentId,
            getCurrentSessionKey: () => get().currentSessionKey,
          });
          if (!canApply) return;
          applyHistorySnapshot(rawMessages, thinkingLevel, {
            isRunning: typeof data.isRunning === 'boolean' ? data.isRunning : undefined,
            runtimeResult: data.runtimeResult,
          });
        } catch (err) {
          console.warn('Failed to load chat history:', err);
          if (get().currentSessionKey !== targetSessionKey) return;
          const fallbackMessages = await loadFallbackMessagesForSession(targetSessionKey);
          if (get().currentSessionKey !== targetSessionKey) return;
          if (fallbackMessages.length > 0) {
            logChatFlow('history.load.fallback', {
              sessionKey: targetSessionKey,
              fallbackCount: fallbackMessages.length,
            });
            const canApply = await prepareHistoryToolEffects({
              rawMessages: fallbackMessages,
              sessionKey: targetSessionKey,
              agentId: get().currentAgentId,
              getCurrentSessionKey: () => get().currentSessionKey,
            });
            if (!canApply) return;
            applyHistorySnapshot(fallbackMessages, null);
          } else if (get().currentSessionKey === targetSessionKey) {
            set({ messages: [], loading: false });
          }
        }
      })();

      _historyLoadInFlight.set(targetSessionKey, loadPromise);
      try {
        await loadPromise;
      } finally {
        // 正常完成时清除安全定时器
        if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
        if (!loadingTimedOut) {
          // Only update load time if we actually didn't time out
          _lastHistoryLoadAtBySession.set(targetSessionKey, Date.now());
        }

        const active = _historyLoadInFlight.get(targetSessionKey);
        if (active === loadPromise) {
          _historyLoadInFlight.delete(targetSessionKey);
        }
      }
    },

  };
}
