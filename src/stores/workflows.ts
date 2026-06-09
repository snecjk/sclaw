/**
 * Workflow State Store
 * Manages workflow template list, selection, and execution constraints.
 */
import { create } from 'zustand';
import { searchWorkflowTemplates } from '@/lib/workflow-api';
import { useChatStore } from '@/stores/chat';
import type { WorkflowTemplateSearchItem } from '@/types/workflow';

export interface WorkflowsState {
  templates: WorkflowTemplateSearchItem[];
  loading: boolean;
  error: string | null;
  selectedWorkflowId: string | null;
  lastFetchedAt: number | null;

  loadTemplates: (query?: string) => Promise<void>;
  /** Preload top templates for picker / bare "创建工作流" — deduped with TTL. */
  prefetchTemplates: (query?: string) => Promise<void>;
  selectWorkflow: (id: string) => void;
  clearSelection: () => void;
}

const PREFETCH_TTL_MS = 5 * 60 * 1000;
let prefetchInFlight: Promise<void> | null = null;

const MAX_CONCURRENT_WORKFLOWS = 5;

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  selectedWorkflowId: null,
  lastFetchedAt: null,

  loadTemplates: async (query = '') => {
    set({ loading: true, error: null });
    try {
      const result = await searchWorkflowTemplates(query || '工作流', 10);
      const templates = [...(result.matchedItems ?? []), ...(result.recommendedItems ?? [])];
      set({ templates, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
      console.error('[WorkflowsStore] loadTemplates failed:', message);
    }
  },

  prefetchTemplates: async (query = '') => {
    const { templates, lastFetchedAt } = get();
    if (
      templates.length > 0 &&
      lastFetchedAt &&
      Date.now() - lastFetchedAt < PREFETCH_TTL_MS
    ) {
      return;
    }
    if (prefetchInFlight) {
      await prefetchInFlight;
      return;
    }
    prefetchInFlight = get()
      .loadTemplates(query)
      .finally(() => {
        prefetchInFlight = null;
      });
    await prefetchInFlight;
  },

  selectWorkflow: (id: string) => {
    set({ selectedWorkflowId: id });
  },

  clearSelection: () => {
    set({ selectedWorkflowId: null });
  },
}));

/** Check if a new workflow can be started (concurrency limit) */
export function canStartWorkflow(): boolean {
  // Count active executions from chat store
  const { workflowCardStates } = useChatStore.getState();
  const activeCount = Object.values(workflowCardStates).filter(
    (s) => s.status === 'pending' || s.status === 'running',
  ).length;
  return activeCount < MAX_CONCURRENT_WORKFLOWS;
}
