/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import { isWorkflowOpenClawSessionKey } from '../../shared/workflow-openclaw-session';
import type { GatewayStatus } from '../types/gateway';
import {
  initializeChatRuntimeV2,
  subscribeCanonicalChatRuntimeProjection,
} from './chat/runtime-v2-store';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import {
  markSessionUnreadAfterSuccessfulRun,
  noteObservedRun,
} from '@/lib/session-unread-notify';
import { touchSessionReadAt } from '@/stores/session-unread';
import { isVirtualTaskSessionKey } from './chat/cron-session-utils';
import { getAgentIdFromSessionKey } from './chat/session-identity';
import { dispatchBuiltinToolResult } from '@/lib/builtin-tool-dispatch';
import type { RawMessage } from './chat/types';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;

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

function handleCanonicalChatEvent(event: CanonicalChatEvent): void {
  if (isWorkflowOpenClawSessionKey(event.sessionKey)) return;
  if (event.type === 'run.started' || event.type === 'message.delta' || event.type === 'message.final') {
    noteObservedRun(event.runId);
  }
  void import('./chat').then((chatModule) => {
    const state = chatModule.useChatStore.getState();
    switch (event.type) {
      case 'run.dispatching':
      case 'run.accepted':
        return;
      case 'run.started': {
        if (
          isVirtualTaskSessionKey(event.sessionKey)
          && !state.sessions.some((session) => session.key === event.sessionKey)
        ) {
          chatModule.useChatStore.setState((current) => ({
            sessions: [...current.sessions, {
              key: event.sessionKey,
              engineType: event.engineType,
              agentId: getAgentIdFromSessionKey(event.sessionKey),
            }],
          }));
        }
        return;
      }
      case 'message.delta':
      case 'message.final':
        return;
      case 'tool.updated': {
        const message = event.payload as RawMessage | null;
        if (message) {
          void dispatchBuiltinToolResult({
            id: message.id,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            content: message.content,
          }, {
            sessionKey: event.sessionKey,
            agentId: getAgentIdFromSessionKey(event.sessionKey),
          }).then(() => {
            void chatModule.useChatStore.getState().loadHistory(true, true, event.sessionKey);
          });
        }
        return;
      }
      case 'run.awaiting_transcript':
        return;
      case 'transcript.updated': {
        void state.loadHistory(true, true, event.sessionKey);
        return;
      }
      case 'run.completed': {
        if (event.sessionKey === state.currentSessionKey) touchSessionReadAt(event.sessionKey);
        else markSessionUnreadAfterSuccessfulRun(event.sessionKey, state.currentSessionKey, { runId: event.runId });
        void state.loadHistory(true, true, event.sessionKey);
        void state.loadSessions();
        return;
      }
      case 'run.failed':
      case 'run.interrupted':
      case 'run.aborted': {
        void state.loadHistory(true, true, event.sessionKey);
        return;
      }
    }
  }).catch((error) => {
    console.warn('[chat-runtime] canonical event bridge failed', error);
  });
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
        const projectionUnsubscribe = gatewayEventUnsubscribers
          ? null
          : subscribeCanonicalChatRuntimeProjection(handleCanonicalChatEvent);
        await initializeChatRuntimeV2().catch((error) => {
          console.warn('[chat-runtime] initialization failed', error);
        });

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
            set({ status: payload });
          }));
          unsubscribers.push(subscribeHostEvent<{ message?: string }>('gateway:error', (payload) => {
            set({ lastError: payload.message || 'Gateway error' });
          }));
          if (projectionUnsubscribe) unsubscribers.push(projectionUnsubscribe);
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
        } else {
          projectionUnsubscribe?.();
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
