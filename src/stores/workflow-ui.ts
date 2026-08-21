import { create } from 'zustand';

interface WorkflowUiState {
  editorActive: boolean;
  embeddedHeaderOwned: boolean;
  embeddedHeaderNegotiating: boolean;
  setEditorActive: (active: boolean) => void;
  setEmbeddedHeaderOwned: (owned: boolean) => void;
  setEmbeddedHeaderNegotiating: (negotiating: boolean) => void;
}

export function shouldHideWorkflowContentHeader(state: Pick<
  WorkflowUiState,
  'editorActive' | 'embeddedHeaderOwned' | 'embeddedHeaderNegotiating'
>): boolean {
  return state.editorActive && (state.embeddedHeaderOwned || state.embeddedHeaderNegotiating);
}

/** 工作流编辑面板激活时，侧栏收成图标轨（交互说明 §1.1） */
export const useWorkflowUiStore = create<WorkflowUiState>((set) => ({
  editorActive: false,
  embeddedHeaderOwned: false,
  embeddedHeaderNegotiating: false,
  setEditorActive: (editorActive) => set({ editorActive }),
  setEmbeddedHeaderOwned: (embeddedHeaderOwned) => set({
    embeddedHeaderOwned,
    ...(embeddedHeaderOwned ? { embeddedHeaderNegotiating: false } : {}),
  }),
  setEmbeddedHeaderNegotiating: (embeddedHeaderNegotiating) => set({ embeddedHeaderNegotiating }),
}));
