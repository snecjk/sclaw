import type { ChatGet, ChatSet, WorkflowActions } from './store-api';
import type { PendingWorkflow } from './types';

/** Workflow state mutations and draft persistence. */
export function createWorkflowActions(set: ChatSet, get: ChatGet): WorkflowActions {
  return {
    setPendingWorkflow: (pending: PendingWorkflow | null, requestedSessionKey?: string) => {
      const sessionKey = requestedSessionKey ?? get().currentSessionKey;
      set((state) => ({
        workflowChatUiBySessionKey: {
          ...state.workflowChatUiBySessionKey,
          [sessionKey]: {
            pendingWorkflow: pending,
            formDecorations: pending?.schemaHash
              ? [{ templateId: pending.templateId, schemaHash: pending.schemaHash }]
              : [],
          },
        },
      }));
      if (!pending) return;
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
    clearPendingWorkflowMemory: (requestedSessionKey?: string) => {
      const sessionKey = requestedSessionKey ?? get().currentSessionKey;
      set((state) => ({
        workflowChatUiBySessionKey: {
          ...state.workflowChatUiBySessionKey,
          [sessionKey]: { pendingWorkflow: null, formDecorations: [] },
        },
      }));
    },
    clearPendingWorkflow: (requestedSessionKey?: string) => {
      const sessionKey = requestedSessionKey ?? get().currentSessionKey;
      const templateId = get().workflowChatUiBySessionKey[sessionKey]?.pendingWorkflow?.templateId;
      set((state) => ({
        workflowChatUiBySessionKey: {
          ...state.workflowChatUiBySessionKey,
          [sessionKey]: { pendingWorkflow: null, formDecorations: [] },
        },
      }));
      void import('@/stores/workflow-memory').then(({ clearPendingWorkflowDraft }) => {
        clearPendingWorkflowDraft(sessionKey, templateId);
      });
    },
  };
}
