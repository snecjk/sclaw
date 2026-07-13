import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import type { WorkflowExecutionState } from '@/types/workflow';
import type { ChatSession, RawMessage, WorkflowContextBlock } from './types';
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';

export interface PreparedSendContext {
  messageWithContext: string;
  displayText: string;
  claudeMemorySystemPrompt?: string;
}

export async function prepareSendContext(input: {
  trimmedText: string;
  sessionKey: string;
  messages: RawMessage[];
  workflowCardStates: Record<string, WorkflowExecutionState>;
  workflowContext?: WorkflowContextBlock | null;
  embedBrowserContext?: SclawBrowserEmbedContextBlock | null;
  engineType?: ChatSession['engineType'];
  agentId?: string | null;
  clearPendingWorkflow: () => void;
}): Promise<PreparedSendContext> {
  const {
    agentId,
    clearPendingWorkflow,
    engineType,
    embedBrowserContext: embedBrowserContextInput,
    messages,
    sessionKey,
    trimmedText,
    workflowCardStates,
    workflowContext,
  } = input;

  const { isSclawBrowserEmbedChatSessionKey } = await import('@/lib/sclaw-browser-chat-session');
  const isEmbedChatSession = isSclawBrowserEmbedChatSessionKey(sessionKey);

  const {
    appendAgentMemoryContextBlock,
  } = await import('@/lib/agent-memory');
  const {
    appendAgentExecutionMemoryContext,
    rememberInjectedExecutionMemories,
  } = await import('@/lib/agent-execution-memory');
  const { buildAgentMemoryContextBlocks } = await import('@/lib/agent-memory-context');
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

  const memoryBlocks = await buildAgentMemoryContextBlocks(trimmedText, { agentId });
  rememberInjectedExecutionMemories(sessionKey, memoryBlocks.injectedExecutionMemories);
  const claudeMemorySystemPrompt = engineType === 'claude'
    ? [memoryBlocks.preference, memoryBlocks.execution]
        .filter((context): context is string => Boolean(context))
        .join('\n\n') || undefined
    : undefined;

  if (engineType !== 'claude') {
    textForGateway = appendAgentMemoryContextBlock(textForGateway, memoryBlocks.preference);
    textForGateway = appendAgentExecutionMemoryContext(textForGateway, memoryBlocks.execution);
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
      stripAgentMemoryContextsForDisplay(
        stripWorkflowContextForDisplay(messageWithContext),
      ),
    ),
  );

  return {
    messageWithContext,
    displayText,
    claudeMemorySystemPrompt,
  };
}
