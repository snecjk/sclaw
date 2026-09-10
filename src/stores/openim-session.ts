import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { SsoUserInfo } from '@/stores/auth';
import { getOpenIMBaseConfig, toOpenIMConfig } from '@/lib/openim/config';
import {
  attachOpenIMRendererSession,
  bootstrapOpenIM,
  getActiveOpenIMUserID,
  getLastBootstrapError,
  isOpenIMReady,
  shutdownOpenIMSession,
} from '@/lib/openim/im-sdk';
import { openimLog } from '@/lib/openim/openim-log';
import type { OpenIMConnectionStatus } from '@/lib/openim/types';

interface OpenIMCredentialsResponse {
  success: boolean;
  enabled?: boolean;
  apiAddr?: string;
  wsAddr?: string;
  userID?: string;
  token?: string;
  imReady?: boolean;
  imStatus?: number | null;
  imError?: string;
  error?: string;
}

interface OpenIMSessionState {
  status: OpenIMConnectionStatus;
  error: string | null;
  userID: string | null;
  /** Global IM unread badge (sidebar / messages tab). */
  totalUnread: number;
  setTotalUnread: (count: number) => void;
  connectForUser: (user: SsoUserInfo) => Promise<void>;
  disconnect: () => Promise<void>;
  retry: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 25_000;
const CREDENTIALS_TIMEOUT_MS = 20_000;

let connectGeneration = 0;
let lastConnectedUserKey: string | null = null;
let activeConnect: { userKey: string; promise: Promise<void> } | null = null;

function buildUserKey(user: SsoUserInfo): string {
  return user.id || user.code || user.empCode;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function fetchCredentials(): Promise<OpenIMCredentialsResponse> {
  return hostApiFetch<OpenIMCredentialsResponse>('/api/openim/credentials');
}

async function runConnect(
  user: SsoUserInfo,
  connectRun: number,
  set: StoreApi<OpenIMSessionState>['setState'],
): Promise<void> {
  const userKey = buildUserKey(user);
  set({ status: 'connecting', error: null });

  const failIfStale = (step: string): boolean => {
    if (connectRun === connectGeneration) return false;
    openimLog(`connect aborted after ${step} (stale generation)`);
    return true;
  };

  openimLog('session connect start', { userKey, connectRun });
  const credentialsResponse = await withTimeout(
    fetchCredentials(),
    CREDENTIALS_TIMEOUT_MS,
    'fetchCredentials',
  );
  if (failIfStale('credentials')) {
    return;
  }

  if (!credentialsResponse.success) {
    throw new Error(credentialsResponse.error || '获取 OpenIM 凭据失败');
  }

  if (!credentialsResponse.enabled) {
    set({ status: 'disabled', error: null, userID: null });
    return;
  }

  const config = toOpenIMConfig({
    apiAddr: credentialsResponse.apiAddr,
    wsAddr: credentialsResponse.wsAddr,
    userID: credentialsResponse.userID,
    token: credentialsResponse.token,
  });

  if (!config.isConfigured) {
    throw new Error('OpenIM 凭据不完整');
  }

  openimLog('session credentials ok', {
    userID: config.userID,
    imReady: credentialsResponse.imReady,
    imStatus: credentialsResponse.imStatus,
    imError: credentialsResponse.imError,
  });

  // Preferred path: main already bootstrapped inside the credentials HTTP handler.
  // Readiness rides on the HTTP response — no wedged invoke/event required.
  if (credentialsResponse.imReady) {
    const attached = attachOpenIMRendererSession(config.userID);
    if (!attached) {
      throw new Error(getLastBootstrapError() || 'OpenIM renderer attach failed');
    }
    lastConnectedUserKey = userKey;
    set({
      status: 'ready',
      error: null,
      userID: config.userID,
    });
    openimLog('session connected via credentials.imReady', { userID: config.userID });
    return;
  }

  if (credentialsResponse.imError) {
    throw new Error(credentialsResponse.imError);
  }

  // Fallback: legacy renderer-driven bootstrap (event/poll).
  const instance = await withTimeout(
    bootstrapOpenIM(config),
    CONNECT_TIMEOUT_MS,
    'bootstrapOpenIM',
  );
  if (failIfStale('bootstrap')) {
    return;
  }

  if (!instance) {
    throw new Error(getLastBootstrapError() || 'OpenIM 连接失败');
  }

  lastConnectedUserKey = userKey;
  set({
    status: 'ready',
    error: null,
    userID: config.userID,
  });
  openimLog('session connected', { userID: config.userID });
}

export const useOpenIMSessionStore = create<OpenIMSessionState>((set, get) => ({
  status: 'disabled',
  error: null,
  userID: null,
  totalUnread: 0,
  setTotalUnread: (count) => {
    const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (get().totalUnread === next) return;
    set({ totalUnread: next });
  },

  connectForUser: async (user: SsoUserInfo) => {
    const baseConfig = getOpenIMBaseConfig();
    if (!baseConfig.enabled) {
      set({ status: 'disabled', error: null, userID: null, totalUnread: 0 });
      return;
    }

    const userKey = buildUserKey(user);
    if (
      lastConnectedUserKey === userKey
      && isOpenIMReady()
      && getActiveOpenIMUserID() === get().userID
      && get().status === 'ready'
    ) {
      openimLog('session connect skipped: already ready', { userKey });
      return;
    }

    if (activeConnect?.userKey === userKey) {
      openimLog('session connect skipped: in flight', { userKey });
      return withTimeout(activeConnect.promise, CONNECT_TIMEOUT_MS, 'activeConnect');
    }

    if (lastConnectedUserKey && lastConnectedUserKey !== userKey) {
      connectGeneration += 1;
      await shutdownOpenIMSession();
    }

    const connectRun = connectGeneration;
    const promise = runConnect(user, connectRun, set)
      .catch((error) => {
        if (connectRun !== connectGeneration) return;
        const message = error instanceof Error ? error.message : String(error);
        lastConnectedUserKey = null;
        set({
          status: 'error',
          error: message,
          userID: null,
          totalUnread: 0,
        });
        openimLog('session connect failed', error);
      })
      .finally(() => {
        if (activeConnect?.userKey === userKey && activeConnect.promise === promise) {
          activeConnect = null;
        }
      });

    activeConnect = { userKey, promise };
    await promise;

    // If we aborted due to stale generation and nothing else took over, surface error.
    if (connectRun === connectGeneration && get().status === 'connecting') {
      set({
        status: 'error',
        error: '连接被中断，请重试',
        userID: null,
        totalUnread: 0,
      });
    }
  },

  disconnect: async () => {
    connectGeneration += 1;
    lastConnectedUserKey = null;
    activeConnect = null;
    await shutdownOpenIMSession();
    set({
      status: 'disabled',
      error: null,
      userID: null,
      totalUnread: 0,
    });
    openimLog('session disconnected');
  },

  retry: async () => {
    connectGeneration += 1;
    activeConnect = null;
    lastConnectedUserKey = null;
    await shutdownOpenIMSession();
    const { connectForUser } = get();
    const { useAuthStore } = await import('@/stores/auth');
    const user = useAuthStore.getState().user;
    if (!user) {
      set({ status: 'error', error: '未登录 StoClaw', userID: null });
      return;
    }
    await connectForUser(user);
  },
}));
