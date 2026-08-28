import { useGatewayStore } from '../gateway';
import { CHAT_HISTORY_LENGTH_MAX_LIMIT } from '../../../shared/chat-config';
import {
  applyLoadedHistorySnapshot,
  prepareHistoryToolEffects,
} from './history-apply-loaded';
import { logChatFlow } from './chat-flow-log';
import {
  cancelHistoryLoadPerf,
  estimateJsonBytes,
  finishHistoryLoadPerf,
  formatPayloadSize,
  markHistoryLoadPerf,
  startHistoryLoadPerf,
} from './history-load-perf';
import type { ChatGet, ChatSet, HistoryActions } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { useChatRuntimeV2Store } from './runtime-v2-store';

const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const _historyLoadInFlight = new Map<string, Promise<void>>();
const _lastHistoryLoadAtBySession = new Map<string, number>();
const _historyGenerationBySession = new Map<string, number>();
const _historyTrailingForce = new Set<string>();

export interface HistoryLoadDeps {
  toMs: (ts: unknown) => number;
  resolveEngineTypeForSession: (
    sessions: ChatSession[],
    sessionKey: string,
    currentAgentId?: string | null,
  ) => ChatSession['engineType'] | undefined;
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
        if (force) _historyTrailingForce.add(targetSessionKey);
        await existingLoad;
        await Promise.resolve();
        if (_historyTrailingForce.delete(targetSessionKey)) {
          return get().loadHistory(quiet, true, targetSessionKey);
        }
        if (!requestedSessionKey && get().currentSessionKey !== targetSessionKey) {
          return get().loadHistory(quiet, force);
        }
        return;
      }

      const lastLoadAt = _lastHistoryLoadAtBySession.get(targetSessionKey) || 0;
      if (quiet && !force && Date.now() - lastLoadAt < HISTORY_LOAD_MIN_INTERVAL_MS) {
        markHistoryLoadPerf(targetSessionKey, 'load.skipped', { reason: 'rate-limited', quiet, force });
        return;
      }

      const engineType = resolveEngineTypeForSession(
        get().sessions,
        targetSessionKey,
        get().currentAgentId,
      );
      const cachedTranscriptCount = useChatRuntimeV2Store.getState()
        .sessionsByKey[targetSessionKey]?.transcript.length ?? 0;

      if (!quiet) set({ loading: true });
      const generation = (_historyGenerationBySession.get(targetSessionKey) ?? 0) + 1;
      _historyGenerationBySession.set(targetSessionKey, generation);
      startHistoryLoadPerf({
        sessionKey: targetSessionKey,
        quiet,
        force,
        engineType,
        cachedTranscriptCount,
      });
      logChatFlow('history.load.start', {
        sessionKey: targetSessionKey,
        quiet,
        force,
        engineType,
        cachedTranscriptCount,
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
          // 任务会话与普通聊天同一路径：仅 chat.history（旧 /api/*/session-history 已 404，不再 fallback）。
          let thinkingLevel: string | null = null;
          const rpcStartedAt = performance.now();
          const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
            'chat.history',
            {
              sessionKey: targetSessionKey,
              limit: CHAT_HISTORY_LENGTH_MAX_LIMIT,
              engineType: resolveEngineTypeForSession(get().sessions, targetSessionKey, get().currentAgentId),
            },
          );
          const rpcMs = Math.round(performance.now() - rpcStartedAt);

          const allMessages: RawMessage[] = Array.isArray(data.messages)
            ? data.messages as RawMessage[]
            : [];
          const payloadBytes = estimateJsonBytes(allMessages);
          markHistoryLoadPerf(targetSessionKey, 'load.rpc.done', {
            rpcMs,
            messageCount: allMessages.length,
            payloadBytes,
            payloadSize: formatPayloadSize(payloadBytes),
            engineType,
          });
          if (_historyGenerationBySession.get(targetSessionKey) !== generation) {
            cancelHistoryLoadPerf(targetSessionKey, 'stale-generation');
            return;
          }
          if (get().currentSessionKey !== targetSessionKey) {
            useChatRuntimeV2Store.getState().setTranscript(targetSessionKey, allMessages);
            finishHistoryLoadPerf(targetSessionKey, { path: 'background-transcript-only' });
            return;
          }
          if (data.thinkingLevel) {
            thinkingLevel = String(data.thinkingLevel);
          }
          logChatFlow('history.load.fetched', {
            sessionKey: targetSessionKey,
            rawCount: allMessages.length,
            gatewayCount: allMessages.length,
            thinkingLevel,
            isRunning: typeof data.isRunning === 'boolean' ? data.isRunning : null,
            rpcMs,
            payloadBytes,
            payloadSize: formatPayloadSize(payloadBytes),
            engineType,
          });

          if (get().currentSessionKey !== targetSessionKey) {
            cancelHistoryLoadPerf(targetSessionKey, 'session-switched-before-apply');
            return;
          }
          const toolEffectsStartedAt = performance.now();
          const canApply = await prepareHistoryToolEffects({
            rawMessages: allMessages,
            sessionKey: targetSessionKey,
            agentId: get().currentAgentId,
            getCurrentSessionKey: () => get().currentSessionKey,
          });
          markHistoryLoadPerf(targetSessionKey, 'load.tool-effects.done', {
            toolEffectsMs: Math.round(performance.now() - toolEffectsStartedAt),
            canApply,
          });
          if (!canApply) {
            cancelHistoryLoadPerf(targetSessionKey, 'tool-effects-blocked');
            return;
          }
          applyHistorySnapshot(allMessages, thinkingLevel, {
            isRunning: typeof data.isRunning === 'boolean' ? data.isRunning : undefined,
            runtimeResult: data.runtimeResult,
          });
          finishHistoryLoadPerf(targetSessionKey, {
            messageCount: allMessages.length,
            payloadBytes,
            payloadSize: formatPayloadSize(payloadBytes),
          });
        } catch (err) {
          console.warn('Failed to load chat history:', err);
          cancelHistoryLoadPerf(targetSessionKey, 'error', {
            error: err instanceof Error ? err.message : String(err),
          });
          if (get().currentSessionKey === targetSessionKey) {
            set({ loading: false });
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
        if (_historyTrailingForce.delete(targetSessionKey)) {
          void get().loadHistory(true, true, targetSessionKey);
        }
      }
    },

  };
}
