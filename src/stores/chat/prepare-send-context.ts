import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import type { WorkflowExecutionState } from '@/types/workflow';
import type { ChatSession, RawMessage, WorkflowContextBlock } from './types';

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
  engineType?: ChatSession['engineType'];
  agentId?: string | null;
  clearPendingWorkflow: () => void;
}): Promise<PreparedSendContext> {
  const {
    agentId,
    clearPendingWorkflow,
    engineType,
    messages,
    sessionKey,
    trimmedText,
    workflowCardStates,
    workflowContext,
  } = input;

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
  if (!workflowContext) {
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

  const messageWithContext = appendWorkflowContext(textForGateway, workflowContext);
  const displayText = stripWorkflowSessionHintForDisplay(
    stripAgentMemoryContextsForDisplay(
      stripWorkflowContextForDisplay(messageWithContext),
    ),
  );

  return {
    messageWithContext,
    displayText,
    claudeMemorySystemPrompt,
  };
}
