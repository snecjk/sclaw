/**
 * Workflow State Store
 * Manages workflow template list, selection, and execution constraints.
 */
import { create } from 'zustand';
import { listWorkflowTemplates, searchWorkflowTemplates } from '@/lib/workflow-api';
import { useChatStore } from '@/stores/chat';
import type { WorkflowTemplateSearchItem } from '@/types/workflow';

export interface LoadTemplatesOptions {
  /** Skip prefetch TTL and reload from API. */
  force?: boolean;
  /** Merge several broad searches for picker default list (not NL intent). */
  catalog?: boolean;
}

export interface WorkflowsState {
  templates: WorkflowTemplateSearchItem[];
  loading: boolean;
  error: string | null;
  selectedWorkflowId: string | null;
  lastFetchedAt: number | null;

  loadTemplates: (query?: string, options?: LoadTemplatesOptions) => Promise<void>;
  /** Preload top templates for picker / bare "创建工作流" — deduped with TTL. */
  prefetchTemplates: (query?: string) => Promise<void>;
  selectWorkflow: (id: string) => void;
  clearSelection: () => void;
}

const PREFETCH_TTL_MS = 5 * 60 * 1000;
const PICKER_PAGE_SIZE = 20;
let prefetchInFlight: Promise<void> | null = null;
let loadInFlight: Promise<void> | null = null;

const MAX_CONCURRENT_WORKFLOWS = 5;

export function mergeWorkflowTemplateItems(
  ...groups: Array<WorkflowTemplateSearchItem[] | undefined | null>
): WorkflowTemplateSearchItem[] {
  const byId = new Map<string, WorkflowTemplateSearchItem>();
  for (const group of groups) {
    if (!group) continue;
    for (const item of group) {
      const prev = byId.get(item.id);
      if (!prev || (item.matchScore ?? 0) > (prev.matchScore ?? 0)) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

async function fetchTemplateCatalog(): Promise<WorkflowTemplateSearchItem[]> {
  const result = await listWorkflowTemplates({ page: 1, pageSize: PICKER_PAGE_SIZE });
  return mergeWorkflowTemplateItems(result.items);
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  selectedWorkflowId: null,
  lastFetchedAt: null,

  loadTemplates: async (query = '', options = {}) => {
    const trimmed = query.trim();
    const useCatalog = options.catalog ?? !trimmed;

    if (loadInFlight && !options.force) {
      await loadInFlight;
      return;
    }

    set({ loading: true, error: null });
    const run = (async () => {
      try {
        let templates: WorkflowTemplateSearchItem[];
        if (useCatalog) {
          templates = await fetchTemplateCatalog();
        } else {
          const result = await searchWorkflowTemplates(trimmed, PICKER_PAGE_SIZE);
          templates = mergeWorkflowTemplateItems(
            result.matchedItems,
            result.recommendedItems,
          );
        }
        set({ templates, loading: false, lastFetchedAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message, loading: false });
        console.error('[WorkflowsStore] loadTemplates failed:', message);
      }
    })();

    loadInFlight = run.finally(() => {
      loadInFlight = null;
    });
    await loadInFlight;
  },

  prefetchTemplates: async () => {
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
      .loadTemplates('', { catalog: true })
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
