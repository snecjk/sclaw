import {
  isWorkflowFormInjectionAllowed,
} from './parameter-form-recovery';
import { getMessageText } from './helpers';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage } from './types';

export function restorePendingWorkflowDraftInBackground(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  rawMessages: RawMessage[];
}): void {
  const { get, rawMessages, sessionKey } = input;
  if (get().workflowChatUiBySessionKey[sessionKey]?.pendingWorkflow) return;

  void import('@/stores/workflow-memory').then(({
    clearPendingWorkflowDraft,
    getPendingWorkflowDraft,
    sessionHasWorkflowExecution,
  }) => {
    const draft = getPendingWorkflowDraft(sessionKey);
    if (!draft) return;
    if (sessionHasWorkflowExecution(sessionKey, draft.templateId)) {
      clearPendingWorkflowDraft(sessionKey, draft.templateId);
      return;
    }

    void import('@/lib/workflow-api').then(({ getStartupSchema }) => {
      getStartupSchema(draft.templateId).then((startup) => {
        if (get().currentSessionKey !== sessionKey) return;
        const msgs = get().messages;
        if (
          !isWorkflowFormInjectionAllowed(
            draft.templateId,
            msgs,
            getMessageText,
            sessionKey,
            { rawMessages },
          )
        ) {
          clearPendingWorkflowDraft(sessionKey, draft.templateId);
          return;
        }
        get().setPendingWorkflow({
          templateId: draft.templateId,
          templateName: draft.templateName,
          schema: startup.schema,
          schemaHash: startup.schemaHash,
          collectedInputs: draft.collectedInputs ?? {},
          modelGuidanceSent: draft.modelGuidanceSent,
        }, sessionKey);
      }).catch(() => {});
    });
  });
}
