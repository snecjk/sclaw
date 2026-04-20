/**
 * Subscriptions State Store
 * Manages subscription feature catalog state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  SubscriptionFeature,
  SubscriptionListResponse,
  SubscriptionToggleResponse,
} from '@/types/subscription';

interface SubscriptionsState {
  features: SubscriptionFeature[];
  loading: boolean;
  error: string | null;
  toggling: Record<string, boolean>;

  fetchFeatures: () => Promise<void>;
  subscribe: (featureId: string) => Promise<void>;
  unsubscribe: (featureId: string) => Promise<void>;
}

export const useSubscriptionsStore = create<SubscriptionsState>((set, get) => ({
  features: [],
  loading: false,
  error: null,
  toggling: {},

  fetchFeatures: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<SubscriptionListResponse>('/api/subscriptions/features');
      if (result.success) {
        set({ features: result.data, loading: false });
        return;
      }
      throw new Error(result.error || 'Failed to fetch features');
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  subscribe: async (featureId: string) => {
    const { toggling } = get();
    if (toggling[featureId]) return;

    set((s) => ({ toggling: { ...s.toggling, [featureId]: true } }));
    try {
      const result = await hostApiFetch<SubscriptionToggleResponse>('/api/subscriptions/subscribe', {
        method: 'POST',
        body: JSON.stringify({ featureId }),
      });
      if (result.success && result.data) {
        set((s) => ({
          features: s.features.map((f) => (f.id === featureId ? result.data! : f)),
          toggling: { ...s.toggling, [featureId]: false },
        }));
        return;
      }
    } catch {
      // ignored – API call failed; keep current state
    }
    set((s) => ({ toggling: { ...s.toggling, [featureId]: false } }));
  },

  unsubscribe: async (featureId: string) => {
    const { toggling } = get();
    if (toggling[featureId]) return;

    set((s) => ({ toggling: { ...s.toggling, [featureId]: true } }));
    try {
      const result = await hostApiFetch<SubscriptionToggleResponse>('/api/subscriptions/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ featureId }),
      });
      if (result.success && result.data) {
        set((s) => ({
          features: s.features.map((f) => (f.id === featureId ? result.data! : f)),
          toggling: { ...s.toggling, [featureId]: false },
        }));
        return;
      }
    } catch {
      // ignored – API call failed; keep current state
    }
    set((s) => ({ toggling: { ...s.toggling, [featureId]: false } }));
  },
}));
