import { create } from 'zustand';
import type { StorageOverview } from '../../shared/storage-management';
import { hostApiFetch } from '@/lib/host-api';

interface StorageState {
  overview: StorageOverview | null;
  loading: boolean;
  error: string | null;
  load: (options?: { force?: boolean; background?: boolean }) => Promise<StorageOverview | null>;
}

export const useStorageStore = create<StorageState>((set) => ({
  overview: null,
  loading: false,
  error: null,
  load: async (options) => {
    set({ loading: true, error: null });
    try {
      const endpoint = options?.force
        ? '/api/storage/refresh'
        : `/api/storage/overview${options?.background ? '?background=1' : ''}`;
      const response = await hostApiFetch<StorageOverview | { deferred: true }>(endpoint, {
        method: options?.force ? 'POST' : 'GET',
        disableTimeout: true,
      });
      if ('deferred' in response) return null;
      set({ overview: response });
      return response;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
}));
