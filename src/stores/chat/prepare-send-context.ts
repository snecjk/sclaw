import type { WorkflowExecutionState } from '@/types/workflow';
import type { RawMessage, WorkflowContextBlock } from './types';
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';

export interface PreparedSendContext {
  messageWithContext: string;
  displayText: string;
}

export async function prepareSendContext(input: {
  trimmedText: string;
  sessionKey: string;
  messages: RawMessage[];
  workflowCardStates: Record<string, WorkflowExecutionState>;
  workflowContext?: WorkflowContextBlock | null;
  embedBrowserContext?: SclawBrowserEmbedContextBlock | null;
  clearPendingWorkflow: () => void;
}): Promise<PreparedSendContext> {
  const {
    clearPendingWorkflow,
    embedBrowserContext: embedBrowserContextInput,
    messages,
    sessionKey,
    trimmedText,
    workflowCardStates,
    workflowContext,
  } = input;

  const { isSclawBrowserEmbedChatSessionKey } = await import('@/lib/sclaw-browser-chat-session');
  const isEmbedChatSession = isSclawBrowserEmbedChatSessionKey(sessionKey);

  const { appendWorkflowContext, stripWorkflowContextForDisplay } = await import('@/lib/workflow-context');
  const {
    buildWorkflowSessionHint,
    buildWorkflowCreationHint,
    appendWorkflowSessionHint,
    stripWorkflowSessionHintForDisplay,
  } = await import('@/lib/workflow-session-hint');

  let textForGateway = trimmedText;
  if (!workflowContext && !isEmbedChatSession) {
    const {
      shouldInjectWorkflowSessionHint,
      isWorkflowCreationIntent,
    } = await import('@/hooks/use-workflow-intent');
    if (shouldInjectWorkflowSessionHint(trimmedText)) {
      const hint = buildWorkflowSessionHint(
        sessionKey,
        messages,
        workflowCardStates,
      );
      textForGateway = appendWorkflowSessionHint(trimmedText, hint);
    } else if (isWorkflowCreationIntent(trimmedText)) {
      clearPendingWorkflow();
      let creationHint = buildWorkflowCreationHint(trimmedText);
      try {
        const { searchWorkflowTemplates } = await import('@/lib/workflow-api');
        const { extractWorkflowSearchQuery } = await import('@/lib/workflow-session-hint');
        const searchResult = await searchWorkflowTemplates(extractWorkflowSearchQuery(trimmedText), 5);
        if (searchResult.matchedItems.length > 0) {
          creationHint = buildWorkflowCreationHint(trimmedText, searchResult.matchedItems);
        }
      } catch (err) {
        console.warn('[workflow-trace] creation hint pre-search failed:', err);
      }
      textForGateway = appendWorkflowSessionHint(trimmedText, creationHint);
    }
  }

  let embedBrowserContext = embedBrowserContextInput ?? null;
  let embedLongSessionNotice: string | null = null;
  if (!embedBrowserContext && isEmbedChatSession) {
    const { useSclawBrowserOverlayStore } = await import('@/stores/sclaw-browser-overlay');
    const overlay = useSclawBrowserOverlayStore.getState();
    const runtimeId = overlay.embedRuntimeId;
    if (runtimeId && overlay.session) {
      const { buildSclawBrowserEmbedContextForSend } = await import('@/lib/sclaw-browser-embed-context-builder');
      const { buildEmbedSessionLongContextNotice } = await import('@/lib/sclaw-browser-embed-context-compaction');
      embedLongSessionNotice = buildEmbedSessionLongContextNotice(messages.length);
      embedBrowserContext = await buildSclawBrowserEmbedContextForSend({
        runtimeId,
        appTitle: overlay.session.title,
        fallbackUrl: overlay.session.url,
      });
    }
  }

  const {
    appendSclawBrowserEmbedContext,
    stripSclawBrowserEmbedContextForDisplay,
  } = await import('@/lib/sclaw-browser-embed-context');
  const messageWithEmbedContext = appendSclawBrowserEmbedContext(textForGateway, embedBrowserContext, {
    longSessionNotice: embedLongSessionNotice,
  });
  const messageWithContext = appendWorkflowContext(messageWithEmbedContext, workflowContext);
  const displayText = stripSclawBrowserEmbedContextForDisplay(
    stripWorkflowSessionHintForDisplay(
      stripWorkflowContextForDisplay(messageWithContext),
    ),
  );

  return {
    messageWithContext,
    displayText,
  };
}
