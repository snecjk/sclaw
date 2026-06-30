/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { markSessionUnreadAfterSuccessfulRun } from '@/lib/session-unread-notify';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;
const gatewayEventDedupe = new Map<string, number>();
const GATEWAY_EVENT_DEDUPE_TTL_MS = 30_000;
const LOAD_SESSIONS_MIN_INTERVAL_MS = 1_200;
const LOAD_HISTORY_MIN_INTERVAL_MS = 800;
const COMPLETION_HISTORY_RELOAD_DELAYS_MS = [1_000, 3_000, 7_000];
let lastLoadSessionsAt = 0;
let lastLoadHistoryAt = 0;

interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
}

interface GatewayState {
  status: GatewayStatus;
  health: GatewayHealth | null;
  isInitialized: boolean;
  lastError: string | null;
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  clearError: () => void;
}

function pruneGatewayEventDedupe(now: number): void {
  for (const [key, ts] of gatewayEventDedupe) {
    if (now - ts > GATEWAY_EVENT_DEDUPE_TTL_MS) {
      gatewayEventDedupe.delete(key);
    }
  }
}

function summarizeGatewayMessageContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim().slice(0, 120);
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const part = block as Record<string, unknown>;
        if (typeof part.text === 'string') return part.text;
        if (typeof part.thinking === 'string') return part.thinking;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, 120);
  }
  if (typeof message.text === 'string') return message.text.trim().slice(0, 120);
  return '';
}

function getGatewayMessageContentLength(message: Record<string, unknown>): number {
  const content = message.content;
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const part = block as Record<string, unknown>;
      if (typeof part.text === 'string') total += part.text.length;
      else if (typeof part.thinking === 'string') total += part.thinking.length;
    }
    return total;
  }
  if (typeof message.text === 'string') return message.text.length;
  return 0;
}

function buildGatewayEventDedupeKey(event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  const state = event.state != null ? String(event.state) : '';
  const message = event.message;
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>;
    const messageId = msg.id != null ? String(msg.id) : '';
    const stopReason = msg.stopReason ?? msg.stop_reason;
    const role = msg.role != null ? String(msg.role) : '';
    const summary = summarizeGatewayMessageContent(msg);
    const contentLen = getGatewayMessageContentLength(msg);
    if (messageId || stopReason || summary) {
      return [
        'msg',
        runId,
        state,
        messageId,
        String(stopReason ?? ''),
        role,
        summary,
        String(contentLen),
      ].join('|');
    }
  }
  if (runId || sessionKey || seq || state) {
    return [runId, sessionKey, seq, state].join('|');
  }
  return null;
}

function shouldProcessGatewayEvent(event: Record<string, unknown>): boolean {
  const key = buildGatewayEventDedupeKey(event);
  if (!key) return true;
  const now = Date.now();
  pruneGatewayEventDedupe(now);
  if (gatewayEventDedupe.has(key)) {
    return false;
  }
  gatewayEventDedupe.set(key, now);
  return true;
}

function maybeLoadSessions(
  state: { loadSessions: () => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadSessionsAt < LOAD_SESSIONS_MIN_INTERVAL_MS) return;
  lastLoadSessionsAt = now;
  void state.loadSessions();
}

function maybeLoadHistory(
  state: { loadHistory: (quiet?: boolean, force?: boolean) => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadHistoryAt < LOAD_HISTORY_MIN_INTERVAL_MS) return;
  lastLoadHistoryAt = now;
  void state.loadHistory(true, force);
}

function scheduleCompletedRunHistoryReload(runId: unknown, sessionKey: unknown): void {
  const completionRunId = runId != null ? String(runId) : null;
  const completionSessionKey = sessionKey != null ? String(sessionKey) : null;

  for (const [index, delayMs] of COMPLETION_HISTORY_RELOAD_DELAYS_MS.entries()) {
    setTimeout(() => {
      import('./chat')
        .then(async ({ useChatStore }) => {
          const state = useChatStore.getState();
          const matchesCurrentSession = completionSessionKey == null || completionSessionKey === state.currentSessionKey;
          const matchesActiveRun = completionRunId != null && state.activeRunId != null && completionRunId === state.activeRunId;
          const backgroundRuntime = completionSessionKey ? state.runtimeBySessionKey[completionSessionKey] : null;
          const hasBackgroundActiveRuntime = Boolean(backgroundRuntime?.sending);
          if (!matchesCurrentSession && !matchesActiveRun && !hasBackgroundActiveRuntime) return;

          if (matchesCurrentSession || matchesActiveRun) {
            await state.loadHistory(true, true);
          }

          if (index !== COMPLETION_HISTORY_RELOAD_DELAYS_MS.length - 1) return;

          const latest = useChatStore.getState();
          const stillMatchesCurrentSession = completionSessionKey == null || completionSessionKey === latest.currentSessionKey;
          const stillMatchesActiveRun = completionRunId != null && latest.activeRunId != null && completionRunId === latest.activeRunId;
          if (stillMatchesCurrentSession || stillMatchesActiveRun) {
            if (!latest.sending) return;
            if (latest.streamingMessage || latest.streamingText) return;

            useChatStore.setState((prev) => ({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              lastUserMessageAt: null,
              runtimeBySessionKey: completionSessionKey
                ? {
                    ...prev.runtimeBySessionKey,
                    [completionSessionKey]: {
                      ...(prev.runtimeBySessionKey[completionSessionKey] ?? {
                        sending: false,
                        activeRunId: null,
                        streamingText: '',
                        streamingMessage: null,
                        streamingTools: [],
                        pendingFinal: false,
                        lastUserMessageAt: null,
                        pendingToolImages: [],
                        error: null,
                        updatedAt: 0,
                      }),
                      sending: false,
                      activeRunId: null,
                      streamingText: '',
                      streamingMessage: null,
                      streamingTools: [],
                      pendingFinal: false,
                      lastUserMessageAt: null,
                      pendingToolImages: [],
                      error: null,
                      updatedAt: Date.now(),
                    },
                  }
                : prev.runtimeBySessionKey,
            }));
            return;
          }

          if (!completionSessionKey) return;
          const sessionRuntime = latest.runtimeBySessionKey[completionSessionKey];
          if (!sessionRuntime?.sending) return;
          if (sessionRuntime.streamingMessage || sessionRuntime.streamingText) return;

          useChatStore.setState((prev) => ({
            runtimeBySessionKey: {
              ...prev.runtimeBySessionKey,
              [completionSessionKey]: {
                ...(prev.runtimeBySessionKey[completionSessionKey] ?? sessionRuntime),
                sending: false,
                activeRunId: null,
                streamingText: '',
                streamingMessage: null,
                streamingTools: [],
                pendingFinal: false,
                lastUserMessageAt: null,
                pendingToolImages: [],
                error: null,
                updatedAt: Date.now(),
              },
            },
          }));
          markSessionUnreadAfterSuccessfulRun(completionSessionKey, latest.currentSessionKey);
        })
        .catch(() => {});
    }, delayMs);
  }
}

async function completeRunAfterAgentCompleted(
  runId: unknown,
  sessionKey: string | null,
): Promise<void> {
  const completionRunId = runId != null ? String(runId) : null;
  const { useChatStore, finalizeOpenClawRunAfterAgentCompleted } = await import('./chat');
  const before = useChatStore.getState();
  const matchesCurrentSession = sessionKey == null || sessionKey === before.currentSessionKey;
  const matchesActiveRun = completionRunId != null
    && before.activeRunId != null
    && completionRunId === before.activeRunId;

  if (matchesCurrentSession || matchesActiveRun) {
    await before.loadHistory(true, true);
  }

  const after = useChatStore.getState();
  if (completionRunId != null && after.activeRunId != null && completionRunId !== after.activeRunId) {
    return;
  }

  finalizeOpenClawRunAfterAgentCompleted(sessionKey);
}

function handleGatewayNotification(notification: { method?: string; params?: Record<string, unknown> } | undefined): void {
  const payload = notification;
  if (!payload || payload.method !== 'agent' || !payload.params || typeof payload.params !== 'object') {
    return;
  }

  const p = payload.params;
  const data = (p.data && typeof p.data === 'object') ? (p.data as Record<string, unknown>) : {};
  const phase = data.phase ?? p.phase;
  const hasChatData = (p.state ?? data.state) || (p.message ?? data.message);

  if (hasChatData) {
    const normalizedEvent: Record<string, unknown> = {
      ...data,
      runId: p.runId ?? data.runId,
      sessionKey: p.sessionKey ?? data.sessionKey,
      stream: p.stream ?? data.stream,
      seq: p.seq ?? data.seq,
      state: p.state ?? data.state,
      message: p.message ?? data.message,
    };
    if (shouldProcessGatewayEvent(normalizedEvent)) {
      import('./chat')
        .then(({ useChatStore }) => {
          useChatStore.getState().handleChatEvent(normalizedEvent);
        })
        .catch(() => {});
    }
  }

  const runId = p.runId ?? data.runId;
  const sessionKey = p.sessionKey ?? data.sessionKey;
  if ((phase === 'started' || phase === 'start') && runId != null && sessionKey != null) {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        let resolvedSessionKey = String(sessionKey);
        // Map cron run session to its daily aggregate key so the sidebar shows
        // loading on the aggregate session instead of the temporary run session.
        import('./chat/cron-session-utils').then(({ getCronRunSessionAggregateKey, parseCronSessionKey }) => {
          const aggregateKey = getCronRunSessionAggregateKey(resolvedSessionKey);
          if (aggregateKey) {
            resolvedSessionKey = aggregateKey;
          } else {
            // If sessionKey is a base cron key, map to dated key if current session is dated
            const parsed = parseCronSessionKey(resolvedSessionKey);
            if (parsed && !parsed.date && !parsed.runSessionId) {
              const currentParsed = parseCronSessionKey(state.currentSessionKey);
              if (currentParsed && currentParsed.date && currentParsed.jobId === parsed.jobId) {
                resolvedSessionKey = state.currentSessionKey;
              }
            }
          }
          const shouldRefreshSessions =
            resolvedSessionKey !== state.currentSessionKey
            || !state.sessions.some((session) => session.key === resolvedSessionKey);
          if (shouldRefreshSessions) {
            maybeLoadSessions(state, true);
          }

          state.handleChatEvent({
            state: 'started',
            runId,
            sessionKey: resolvedSessionKey,
          });
        }).catch(() => {});
      })
      .catch(() => {});
  }

  if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        let resolvedSessionKey = sessionKey != null ? String(sessionKey) : null;
        import('./chat/cron-session-utils').then(({ getCronRunSessionAggregateKey, parseCronSessionKey }) => {
          const aggregateKey = resolvedSessionKey ? getCronRunSessionAggregateKey(resolvedSessionKey) : null;
          if (aggregateKey) {
            resolvedSessionKey = aggregateKey;
          } else if (resolvedSessionKey) {
            // If sessionKey is a base cron key, map to dated key if current session is dated
            const parsed = parseCronSessionKey(resolvedSessionKey);
            if (parsed && !parsed.date && !parsed.runSessionId) {
              const currentParsed = parseCronSessionKey(state.currentSessionKey);
              if (currentParsed && currentParsed.date && currentParsed.jobId === parsed.jobId) {
                resolvedSessionKey = state.currentSessionKey;
              }
            }
          }
          const shouldRefreshSessions = resolvedSessionKey != null && (
            resolvedSessionKey !== state.currentSessionKey
            || !state.sessions.some((session) => session.key === resolvedSessionKey)
          );
          if (shouldRefreshSessions) {
            maybeLoadSessions(state);
          }

          const matchesCurrentSession = resolvedSessionKey == null || resolvedSessionKey === state.currentSessionKey;
          const matchesActiveRun = runId != null && state.activeRunId != null && String(runId) === state.activeRunId;
          const backgroundRuntime = resolvedSessionKey ? state.runtimeBySessionKey[resolvedSessionKey] : null;
          const hasBackgroundActiveRuntime = Boolean(backgroundRuntime?.sending);

          if (matchesCurrentSession || matchesActiveRun) {
            maybeLoadHistory(state, true);
          }
          if ((matchesCurrentSession || matchesActiveRun) && state.sending) {
            void completeRunAfterAgentCompleted(runId, resolvedSessionKey).catch(() => {});
            scheduleCompletedRunHistoryReload(runId, resolvedSessionKey);
          } else if (resolvedSessionKey && hasBackgroundActiveRuntime) {
            void completeRunAfterAgentCompleted(runId, resolvedSessionKey).catch(() => {});
            scheduleCompletedRunHistoryReload(runId, resolvedSessionKey);
          }
        }).catch(() => {});
      })
      .catch(() => {});
  }
}

function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state != null) {
      const normalizedEvent: Record<string, unknown> = {
        ...chatData,
        ...payload,
        state: payload.state,
        message: payload.message ?? chatData.message,
        runId: payload.runId ?? chatData.runId,
        sessionKey: payload.sessionKey ?? chatData.sessionKey,
        seq: payload.seq ?? chatData.seq,
        stream: payload.stream ?? chatData.stream,
      };
      if (!shouldProcessGatewayEvent(normalizedEvent)) return;
      useChatStore.getState().handleChatEvent(normalizedEvent);
      return;
    }

    const normalized: Record<string, unknown> = {
      ...chatData,
      state: chatData.state ?? payload.state ?? 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
      sessionKey: chatData.sessionKey ?? payload.sessionKey,
      seq: chatData.seq ?? payload.seq,
      stream: chatData.stream ?? payload.stream,
    };
    if (!shouldProcessGatewayEvent(normalized)) return;
    useChatStore.getState().handleChatEvent(normalized);
  }).catch(() => {});
}

function mapChannelStatus(status: string): 'connected' | 'connecting' | 'disconnected' | 'error' {
  switch (status) {
    case 'connected':
    case 'running':
      return 'connected';
    case 'connecting':
    case 'starting':
      return 'connecting';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'disconnected';
  }
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  status: {
    state: 'stopped',
    port: 18789,
  },
  health: null,
  isInitialized: false,
  lastError: null,

  init: async () => {
    if (get().isInitialized) return;
    if (gatewayInitPromise) {
      await gatewayInitPromise;
      return;
    }

    gatewayInitPromise = (async () => {
      try {
        const status = await hostApiFetch<GatewayStatus>('/api/gateway/status');
        set({ status, isInitialized: true });

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
            set({ status: payload });
          }));
          unsubscribers.push(subscribeHostEvent<{ message?: string }>('gateway:error', (payload) => {
            set({ lastError: payload.message || 'Gateway error' });
          }));
          unsubscribers.push(subscribeHostEvent<{ method?: string; params?: Record<string, unknown> }>(
            'gateway:notification',
            (payload) => {
              handleGatewayNotification(payload);
            },
          ));
          unsubscribers.push(subscribeHostEvent('gateway:chat-message', (payload) => {
            handleGatewayChatMessage(payload);
          }));
          unsubscribers.push(subscribeHostEvent<{ channelId?: string; status?: string }>(
            'gateway:channel-status',
            (update) => {
              import('./channels')
                .then(({ useChannelsStore }) => {
                  if (!update.channelId || !update.status) return;
                  const state = useChannelsStore.getState();
                  const channel = state.channels.find((item) => item.type === update.channelId);
                  if (channel) {
                    const newStatus = mapChannelStatus(update.status);
                    state.updateChannel(channel.id, { status: newStatus });
                    
                    if (newStatus === 'disconnected' || newStatus === 'error') {
                      state.scheduleAutoReconnect(channel.id);
                    } else if (newStatus === 'connected' || newStatus === 'connecting') {
                      state.clearAutoReconnect(channel.id);
                    }
                  }
                })
                .catch(() => {});
            },
          ));
          gatewayEventUnsubscribers = unsubscribers;
        }
      } catch (error) {
        console.error('Failed to initialize Gateway:', error);
        set({ lastError: String(error) });
      } finally {
        gatewayInitPromise = null;
      }
    })();

    await gatewayInitPromise;
  },

  start: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/start', {
        method: 'POST',
      });
      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  stop: async () => {
    try {
      await hostApiFetch('/api/gateway/stop', { method: 'POST' });
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/restart', {
        method: 'POST',
      });
      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await hostApiFetch<GatewayHealth>('/api/gateway/health');
      set({ health: result });
      return result;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const response = await invokeIpc<{
      success: boolean;
      result?: T;
      error?: string;
    }>('gateway:rpc', method, params, timeoutMs);
    if (!response.success) {
      throw new Error(response.error || `Gateway RPC failed: ${method}`);
    }
    return response.result as T;
  },

  setStatus: (status) => set({ status }),
  clearError: () => set({ lastError: null }),
}));
