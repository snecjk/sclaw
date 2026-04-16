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

// TODO: 后端就绪后移除 mock 数据
const MOCK_FEATURES: SubscriptionFeature[] = [
  {
    id: 'feat-001',
    name: 'Smart Data Export',
    description: 'Export conversation data in multiple formats with AI-powered summaries',
    icon: '📊',
    tags: ['data-analysis', 'ai-enhanced'],
    status: 'unsubscribed',
    updatedAt: '2026-04-10T08:00:00Z',
  },
  {
    id: 'feat-002',
    name: 'Batch Operations',
    description: 'Perform bulk actions on conversations, agents, and skills simultaneously',
    icon: '⚡',
    tags: ['efficiency-tools'],
    status: 'unsubscribed',
    updatedAt: '2026-04-08T10:30:00Z',
  },
  {
    id: 'feat-003',
    name: 'Real-time Collaboration',
    description: 'Collaborate with team members on conversations and shared workspaces in real-time',
    icon: '👥',
    tags: ['communication'],
    status: 'subscribed',
    updatedAt: '2026-04-05T14:00:00Z',
  },
  {
    id: 'feat-004',
    name: 'Advanced Security Scan',
    description: 'Automatically scan conversations and outputs for sensitive data leaks and security risks',
    icon: '🛡️',
    tags: ['security'],
    status: 'unsubscribed',
    updatedAt: '2026-04-01T09:00:00Z',
  },
  {
    id: 'feat-005',
    name: 'Workflow Automation',
    description: 'Create automated workflows triggered by events, schedules, or conversation patterns',
    icon: '🔄',
    tags: ['automation', 'efficiency-tools'],
    status: 'unsubscribed',
    updatedAt: '2026-03-28T16:00:00Z',
  },
  {
    id: 'feat-006',
    name: 'AI Conversation Analytics',
    description: 'Deep analytics on conversation patterns, token usage trends, and model performance',
    icon: '🧠',
    tags: ['ai-enhanced', 'data-analysis'],
    status: 'subscribed',
    updatedAt: '2026-04-12T11:00:00Z',
  },
  {
    id: 'feat-007',
    name: 'Multi-channel Notifications',
    description: 'Receive task and conversation notifications via email, Slack, DingTalk and more',
    icon: '🔔',
    tags: ['communication'],
    status: 'unsubscribed',
    updatedAt: '2026-03-25T08:00:00Z',
  },
  {
    id: 'feat-008',
    name: 'Scheduled Reports',
    description: 'Generate and deliver usage reports on a recurring schedule',
    icon: '📅',
    tags: ['automation', 'data-analysis'],
    status: 'unsubscribed',
    updatedAt: '2026-04-02T13:00:00Z',
  },
  {
    id: 'feat-009',
    name: 'Intelligent Code Review',
    description: 'AI-powered code review with security vulnerability detection and best practice suggestions',
    icon: '🔍',
    tags: ['ai-enhanced', 'security'],
    status: 'unsubscribed',
    updatedAt: '2026-04-09T15:30:00Z',
  },
  {
    id: 'feat-010',
    name: 'Custom Dashboard Widgets',
    description: 'Build and arrange personalized dashboard widgets for monitoring and quick actions',
    icon: '📐',
    tags: ['efficiency-tools'],
    status: 'subscribed',
    updatedAt: '2026-04-11T07:00:00Z',
  },
];

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
    } catch {
      // TODO: 后端就绪后移除 mock 回退
      set({ features: MOCK_FEATURES, loading: false });
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
      // TODO: 后端就绪后移除本地 mock 更新
    }
    // 本地乐观更新
    set((s) => ({
      features: s.features.map((f) =>
        f.id === featureId
          ? { ...f, status: 'subscribed' as const, updatedAt: new Date().toISOString() }
          : f,
      ),
      toggling: { ...s.toggling, [featureId]: false },
    }));
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
      // TODO: 后端就绪后移除本地 mock 更新
    }
    // 本地乐观更新
    set((s) => ({
      features: s.features.map((f) =>
        f.id === featureId
          ? { ...f, status: 'unsubscribed' as const, updatedAt: new Date().toISOString() }
          : f,
      ),
      toggling: { ...s.toggling, [featureId]: false },
    }));
  },
}));
