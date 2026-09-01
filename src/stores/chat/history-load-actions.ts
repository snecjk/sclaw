import { useGatewayStore } from '../gateway';
import { CHAT_HISTORY_LENGTH_MAX_LIMIT, CHAT_HISTORY_LIMIT } from '../../../shared/chat-config';
import {
  applyLoadedHistorySnapshot,
  prepareHistoryToolEffects,
} from './history-apply-loaded';
import { logChatFlow } from './chat-flow-log';
import {
  cancelHistoryLoadPerf,
  finishHistoryLoadPerf,
  markHistoryLoadPerf,
  payloadSizeDetail,
  startHistoryLoadPerf,
} from './history-load-perf';
import type { ChatGet, ChatSet, HistoryActions } from './store-api';
import type { ChatSession, RawMessage } from './types';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { isChatHistoryFingerprint } from '../../../shared/chat-history-fingerprint';
import { mergeHistoryTail, prependHistoryPage } from '../../../shared/chat-history-page';

const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const _historyLoadInFlight = new Map<string, Promise<void>>();
const _lastHistoryLoadAtBySession = new Map<string, number>();
const _historyGenerationBySession = new Map<string, number>();
const _historyTrailingForce = new Set<string>();

/** Quiet reload with a known-good local transcript: skip RPC. Events still force-reconcile. */
export function shouldSkipQuietHistoryRpc(input: {
  quiet: boolean;
  force: boolean;
  cachedTranscriptCount: number;
}): boolean {
  return input.quiet
    && !input.force
    && input.cachedTranscriptCount > 0;
}

const _olderHistoryLoadInFlight = new Map<string, Promise<void>>();

export function sessionHasOlderHistory(sessionKey: string): boolean {
  const session = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey];
  if (!session) return false;
  return session.historyTotalCount > session.transcript.length;
}

function historyPageLimit(engineType: ChatSession['engineType'] | undefined): number {
  return engineType === 'claude' ? CHAT_HISTORY_LIMIT : CHAT_HISTORY_LENGTH_MAX_LIMIT;
}

function readHistoryTotalCount(value: unknown, messageCount: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : messageCount;
}

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
      const sessionState = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey];
      const cachedTranscriptCount = sessionState?.transcript.length ?? 0;
      const cachedFingerprint = cachedTranscriptCount > 0
        ? sessionState?.historyFingerprint ?? null
        : null;

      if (shouldSkipQuietHistoryRpc({
        quiet,
        force,
        cachedTranscriptCount,
      })) {
        markHistoryLoadPerf(targetSessionKey, 'load.skipped', {
          reason: 'local-cache',
          quiet,
          force,
          cachedTranscriptCount,
          engineType,
        });
        return;
      }

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
        hasCachedFingerprint: Boolean(cachedFingerprint),
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
          const pageLimit = historyPageLimit(engineType);
          const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
            'chat.history',
            {
              sessionKey: targetSessionKey,
              limit: pageLimit,
              engineType: resolveEngineTypeForSession(get().sessions, targetSessionKey, get().currentAgentId),
              ...(cachedFingerprint ? { clientFingerprint: cachedFingerprint } : {}),
            },
          );
          const rpcMs = Math.round(performance.now() - rpcStartedAt);
          const nextFingerprint = isChatHistoryFingerprint(data.fingerprint) ? data.fingerprint : null;

          if (data.unchanged === true) {
            const cachedLength = useChatRuntimeV2Store.getState()
              .sessionsByKey[targetSessionKey]?.transcript.length ?? 0;
            if (cachedLength > 0) {
              useChatRuntimeV2Store.getState().setHistoryFingerprint(
                targetSessionKey,
                nextFingerprint ?? cachedFingerprint,
              );
              markHistoryLoadPerf(targetSessionKey, 'load.reconciled', {
                rpcMs,
                messageCount: cachedLength,
                engineType,
                fingerprintHit: true,
              });
              if (get().currentSessionKey === targetSessionKey && !quiet) {
                set({ loading: false });
              }
              finishHistoryLoadPerf(targetSessionKey, {
                path: 'fingerprint-hit',
                rpcMs,
                messageCount: cachedLength,
              });
              return;
            }
            markHistoryLoadPerf(targetSessionKey, 'load.reconciled', {
              rpcMs,
              engineType,
              fingerprintHit: false,
              reason: 'empty-cache',
            });
            finishHistoryLoadPerf(targetSessionKey, { path: 'fingerprint-hit-without-cache' });
            return;
          }

          const pageMessages: RawMessage[] = Array.isArray(data.messages)
            ? data.messages as RawMessage[]
            : [];
          const existingTranscript = useChatRuntimeV2Store.getState()
            .sessionsByKey[targetSessionKey]?.transcript ?? [];
          const allMessages = engineType === 'claude'
            ? mergeHistoryTail(existingTranscript, pageMessages)
            : pageMessages;
          const totalCount = readHistoryTotalCount(data.totalCount, allMessages.length);
          const payloadDetail = payloadSizeDetail(pageMessages);
          markHistoryLoadPerf(targetSessionKey, 'load.rpc.done', {
            rpcMs,
            messageCount: allMessages.length,
            ...payloadDetail,
            engineType,
          });
          if (_historyGenerationBySession.get(targetSessionKey) !== generation) {
            cancelHistoryLoadPerf(targetSessionKey, 'stale-generation');
            return;
          }
          if (get().currentSessionKey !== targetSessionKey) {
            useChatRuntimeV2Store.getState().setTranscript(targetSessionKey, allMessages);
            useChatRuntimeV2Store.getState().setHistoryFingerprint(targetSessionKey, nextFingerprint);
            useChatRuntimeV2Store.getState().setHistoryTotalCount(targetSessionKey, totalCount);
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
            ...payloadDetail,
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
          useChatRuntimeV2Store.getState().setHistoryFingerprint(targetSessionKey, nextFingerprint);
          useChatRuntimeV2Store.getState().setHistoryTotalCount(targetSessionKey, totalCount);
          finishHistoryLoadPerf(targetSessionKey, {
            messageCount: allMessages.length,
            pageCount: pageMessages.length,
            totalCount,
            ...payloadDetail,
          });
        } catch (err) {
          console.warn('Failed to load chat history:', err);
          useChatRuntimeV2Store.getState().setHistoryFingerprint(targetSessionKey, null);
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

    loadOlderHistory: async (requestedSessionKey?: string, options?: { drain?: boolean }) => {
      const targetSessionKey = requestedSessionKey ?? get().currentSessionKey;
      if (_olderHistoryLoadInFlight.has(targetSessionKey)) {
        return _olderHistoryLoadInFlight.get(targetSessionKey);
      }
      const blockingHistory = _historyLoadInFlight.get(targetSessionKey);
      if (blockingHistory) {
        await blockingHistory;
        return get().loadOlderHistory(targetSessionKey, options);
      }
      const engineType = resolveEngineTypeForSession(
        get().sessions,
        targetSessionKey,
        get().currentAgentId,
      );
      if (engineType !== 'claude' || !sessionHasOlderHistory(targetSessionKey)) return;

      const existing = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey]?.transcript ?? [];
      const beforeId = existing.find((message) => typeof message.id === 'string' && message.id)?.id;
      if (!beforeId) return;

      const loadPromise = (async () => {
        markHistoryLoadPerf(targetSessionKey, 'load.older.start', {
          beforeId,
          drain: Boolean(options?.drain),
          cachedTranscriptCount: existing.length,
        });
        const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
          'chat.history',
          {
            sessionKey: targetSessionKey,
            limit: options?.drain ? CHAT_HISTORY_LENGTH_MAX_LIMIT : CHAT_HISTORY_LIMIT,
            beforeId,
            engineType,
          },
        );
        const olderMessages: RawMessage[] = Array.isArray(data.messages)
          ? data.messages as RawMessage[]
          : [];
        const latest = useChatRuntimeV2Store.getState().sessionsByKey[targetSessionKey]?.transcript ?? [];
        const merged = prependHistoryPage(latest, olderMessages);
        const totalCount = olderMessages.length === 0
          ? merged.length
          : Math.max(readHistoryTotalCount(data.totalCount, merged.length), merged.length);
        if (get().currentSessionKey === targetSessionKey) {
          applyLoadedHistorySnapshot({
            get,
            set,
            deps,
            targetSessionKey,
            rawMessages: merged,
            thinkingLevel: get().thinkingLevel,
          });
        } else {
          useChatRuntimeV2Store.getState().setTranscript(targetSessionKey, merged);
        }
        useChatRuntimeV2Store.getState().setHistoryTotalCount(targetSessionKey, totalCount);
        markHistoryLoadPerf(targetSessionKey, 'load.older.done', {
          beforeId,
          pageCount: olderMessages.length,
          messageCount: merged.length,
          totalCount,
        });
      })();

      _olderHistoryLoadInFlight.set(targetSessionKey, loadPromise);
      try {
        await loadPromise;
      } finally {
        if (_olderHistoryLoadInFlight.get(targetSessionKey) === loadPromise) {
          _olderHistoryLoadInFlight.delete(targetSessionKey);
        }
      }
    },

  };
}
