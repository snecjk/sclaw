import { create } from 'zustand';

interface WorkflowUiState {
  editorActive: boolean;
  setEditorActive: (active: boolean) => void;
}

/** 工作流编辑面板激活时，侧栏收成图标轨（交互说明 §1.1） */
export const useWorkflowUiStore = create<WorkflowUiState>((set) => ({
  editorActive: false,
  setEditorActive: (editorActive) => set({ editorActive }),
}));
