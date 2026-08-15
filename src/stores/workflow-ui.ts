import { create } from 'zustand';

interface WorkflowUiState {
  editorActive: boolean;
  embeddedHeaderOwned: boolean;
  setEditorActive: (active: boolean) => void;
  setEmbeddedHeaderOwned: (owned: boolean) => void;
}

export function shouldHideWorkflowContentHeader(state: Pick<
  WorkflowUiState,
  'editorActive' | 'embeddedHeaderOwned'
>): boolean {
  return state.editorActive && state.embeddedHeaderOwned;
}

/** 工作流编辑面板激活时，侧栏收成图标轨（交互说明 §1.1） */
export const useWorkflowUiStore = create<WorkflowUiState>((set) => ({
  editorActive: false,
  embeddedHeaderOwned: false,
  setEditorActive: (editorActive) => set({ editorActive }),
  setEmbeddedHeaderOwned: (embeddedHeaderOwned) => set({ embeddedHeaderOwned }),
}));
