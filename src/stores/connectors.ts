import { create } from 'zustand';

import {
  connectConnector,
  disconnectConnector,
  fetchConnectors,
  refreshConnectorStatus,
  tokenConnectConnector,
} from '@/lib/connectors-api';
import type { ConnectorViewItem } from '../../shared/connectors/types';

interface ConnectorsState {
  items: ConnectorViewItem[];
  loading: boolean;
  error: string | null;
  connectingId: string | null;
  fetchList: (refresh?: boolean) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  tokenConnect: (id: string, serverUrl: string, token: string) => Promise<void>;
  refreshStatus: (id: string) => Promise<void>;
}

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function replaceItem(items: ConnectorViewItem[], next: ConnectorViewItem): ConnectorViewItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

export const useConnectorsStore = create<ConnectorsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  connectingId: null,

  fetchList: async (refresh = true) => {
    set({ loading: true, error: null });
    try {
      const items = await fetchConnectors(refresh);
      set({ items, loading: false });
    } catch (error) {
      set({ loading: false, error: toError(error) });
    }
  },

  connect: async (id: string) => {
    set({ connectingId: id, error: null });
    const prev = get().items.find((item) => item.id === id);
    if (prev) {
      set({
        items: replaceItem(get().items, {
          ...prev,
          localStatus: 'installing',
          lastError: null,
        }),
      });
    }
    try {
      const next = await connectConnector(id);
      set({ items: replaceItem(get().items, next), connectingId: null });
    } catch (error) {
      const message = toError(error);
      if (/取消/.test(message)) {
        try {
          const items = await fetchConnectors(true);
          set({ items, connectingId: null, error: null });
        } catch {
          set({ connectingId: null, error: message });
        }
        throw error;
      }
      const current = get().items.find((item) => item.id === id);
      if (current) {
        set({
          items: replaceItem(get().items, {
            ...current,
            localStatus: 'error',
            lastError: message,
          }),
          connectingId: null,
          error: message,
        });
      } else {
        set({ connectingId: null, error: message });
      }
      throw error;
    }
  },

  disconnect: async (id: string) => {
    set({ error: null });
    const next = await disconnectConnector(id);
    set({ items: replaceItem(get().items, next) });
  },

  tokenConnect: async (id: string, serverUrl: string, token: string) => {
    set({ connectingId: id, error: null });
    const prev = get().items.find((item) => item.id === id);
    if (prev) {
      set({
        items: replaceItem(get().items, {
          ...prev,
          localStatus: 'authorizing',
          lastError: null,
        }),
      });
    }
    try {
      const next = await tokenConnectConnector(id, serverUrl, token);
      set({ items: replaceItem(get().items, next), connectingId: null });
    } catch (error) {
      const message = toError(error);
      const current = get().items.find((item) => item.id === id);
      if (current) {
        set({
          items: replaceItem(get().items, {
            ...current,
            localStatus: 'error',
            lastError: message,
          }),
          connectingId: null,
          error: message,
        });
      } else {
        set({ connectingId: null, error: message });
      }
      throw error;
    }
  },

  refreshStatus: async (id: string) => {
    const next = await refreshConnectorStatus(id);
    set({ items: replaceItem(get().items, next) });
  },
}));
