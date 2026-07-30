import type { ChatGet, ChatSet, WorkflowActions } from './store-api';
import type { ChatState } from './types';

/** Workflow state mutations and draft persistence. */
export function createWorkflowActions(set: ChatSet, get: ChatGet): WorkflowActions {
  return {
    setPendingWorkflow: (pending: ChatState['pendingWorkflow']) => {
      set({ pendingWorkflow: pending });
      if (!pending) return;

      const sessionKey = get().currentSessionKey;
      void import('@/stores/workflow-memory').then(({ savePendingWorkflowDraft }) => {
        savePendingWorkflowDraft(sessionKey, {
          templateId: pending.templateId,
          templateName: pending.templateName,
          schemaHash: pending.schemaHash,
          collectedInputs: pending.collectedInputs,
          modelGuidanceSent: pending.modelGuidanceSent,
        });
      });
    },
    clearPendingWorkflowMemory: () => {
      set({ pendingWorkflow: null });
    },
    clearPendingWorkflow: () => {
      const sessionKey = get().currentSessionKey;
      const templateId = get().pendingWorkflow?.templateId;
      set({ pendingWorkflow: null });
      void import('@/stores/workflow-memory').then(({ clearPendingWorkflowDraft }) => {
        clearPendingWorkflowDraft(sessionKey, templateId);
      });
    },
  };
}
