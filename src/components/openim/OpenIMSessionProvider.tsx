import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { CbEvents } from '@openim/wasm-client-sdk';
import type { WSEvent } from '@openim/wasm-client-sdk';
import { useAuthStore } from '@/stores/auth';
import { useOpenIMSessionStore } from '@/stores/openim-session';
import { getIMSDK, isOpenIMReady } from '@/lib/openim/im-sdk';
import { openimLog } from '@/lib/openim/openim-log';
import { isAuxiliaryWindowPath } from '@/lib/auxiliary-window-route';

function unwrapEventData<T>(payload: T | WSEvent<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as WSEvent<T>).data;
  }
  return payload as T;
}

async function refreshTotalUnread(): Promise<void> {
  if (!isOpenIMReady()) return;
  const im = getIMSDK();
  if (!im) return;
  try {
    const response = await im.getTotalUnreadMsgCount();
    useOpenIMSessionStore.getState().setTotalUnread(response.data ?? 0);
  } catch (error) {
    openimLog('refreshTotalUnread failed', error);
  }
}

/**
 * Boots OpenIM when StoClaw auth becomes active; tears down on logout.
 * Also keeps global totalUnread in sync for the sidebar badge.
 * Mounted once in App — not tied to the Messages route.
 */
export function OpenIMSessionProvider() {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
  const userKey = useAuthStore((state) => state.user?.id || state.user?.code || state.user?.empCode || null);
  const connectForUser = useOpenIMSessionStore((state) => state.connectForUser);
  const disconnect = useOpenIMSessionStore((state) => state.disconnect);
  const retry = useOpenIMSessionStore((state) => state.retry);
  const sessionStatus = useOpenIMSessionStore((state) => state.status);
  const lastKeyRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAuxiliaryWindowPath(location.pathname)) return;
    if (!isAuthInitialized) return;

    if (isAuthenticated && userKey) {
      if (lastKeyRef.current === userKey) return;
      lastKeyRef.current = userKey;
      const user = useAuthStore.getState().user;
      if (user) void connectForUser(user);
      return;
    }

    if (lastKeyRef.current !== null) {
      lastKeyRef.current = null;
      void disconnect();
    }
  }, [
    connectForUser,
    disconnect,
    isAuthenticated,
    isAuthInitialized,
    userKey,
    location.pathname,
  ]);

  // Keep sidebar unread badge live even when Messages page is not mounted.
  useEffect(() => {
    if (sessionStatus !== 'ready' || !isOpenIMReady()) return;
    const im = getIMSDK();
    if (!im) return;

    void refreshTotalUnread();

    const handleTotalUnreadChanged = (payload: number | WSEvent<number>) => {
      const data = unwrapEventData(payload);
      if (typeof data === 'number') {
        useOpenIMSessionStore.getState().setTotalUnread(data);
      }
    };

    const scheduleReconnect = (reason: string) => {
      openimLog('session invalid; scheduling reconnect', { reason });
      useOpenIMSessionStore.getState().setTotalUnread(0);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void retry();
      }, 400);
    };

    const handleTokenInvalid = () => scheduleReconnect('OnUserTokenInvalid');
    const handleTokenExpired = () => scheduleReconnect('OnUserTokenExpired');
    const handleKickedOffline = () => scheduleReconnect('OnKickedOffline');

    im.on(CbEvents.OnTotalUnreadMessageCountChanged, handleTotalUnreadChanged);
    im.on(CbEvents.OnUserTokenInvalid, handleTokenInvalid);
    im.on(CbEvents.OnUserTokenExpired, handleTokenExpired);
    im.on(CbEvents.OnKickedOffline, handleKickedOffline);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      im.off(CbEvents.OnTotalUnreadMessageCountChanged, handleTotalUnreadChanged);
      im.off(CbEvents.OnUserTokenInvalid, handleTokenInvalid);
      im.off(CbEvents.OnUserTokenExpired, handleTokenExpired);
      im.off(CbEvents.OnKickedOffline, handleKickedOffline);
    };
  }, [retry, sessionStatus]);

  return null;
}
