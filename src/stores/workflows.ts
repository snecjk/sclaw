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

  loadTemplates: (query?: string) => Promise<void>;
  selectWorkflow: (id: string) => void;
  clearSelection: () => void;
}

const MAX_CONCURRENT_WORKFLOWS = 5;

export const useWorkflowsStore = create<WorkflowsState>((set) => ({
  templates: [],
  loading: false,
  error: null,
  selectedWorkflowId: null,

  loadTemplates: async (query = '') => {
    set({ loading: true, error: null });
    try {
      const result = await searchWorkflowTemplates(query || '工作流', 10);
      console.log('[WorkflowsStore] loadTemplates result:', JSON.stringify(result, null, 2));
      const templates = [...(result.matchedItems ?? []), ...(result.recommendedItems ?? [])];
      console.log('[WorkflowsStore] templates count:', templates.length);
      set({ templates, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
      console.error('[WorkflowsStore] loadTemplates failed:', message);
    }
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
