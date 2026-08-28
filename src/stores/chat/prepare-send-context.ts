import type { RawMessage, WorkflowContextBlock } from './types';
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';
import type { SkillMeta } from '@/types/skill-meta';
import { hasQuoteAssistantSkill } from '../../../shared/quote-embed-app';

export interface PreparedSendContext {
  messageWithContext: string;
  displayText: string;
}

export async function prepareSendContext(input: {
  trimmedText: string;
  sessionKey: string;
  messages: RawMessage[];
  workflowContext?: WorkflowContextBlock | null;
  embedBrowserContext?: SclawBrowserEmbedContextBlock | null;
  skillMetas?: SkillMeta[];
  clearPendingWorkflow: () => void;
}): Promise<PreparedSendContext> {
  const {
    clearPendingWorkflow,
    embedBrowserContext: embedBrowserContextInput,
    messages,
    sessionKey,
    skillMetas,
    trimmedText,
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
        {},
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
    const { resolveEmbedRuntimeForChatSend } = await import('@/lib/resolve-embed-runtime-for-chat-send');
    const embedRuntime = await resolveEmbedRuntimeForChatSend(sessionKey);
    if (embedRuntime) {
      const { buildSclawBrowserEmbedContextForSend } = await import('@/lib/sclaw-browser-embed-context-builder');
      const { buildEmbedSessionLongContextNotice } = await import('@/lib/sclaw-browser-embed-context-compaction');
      embedLongSessionNotice = buildEmbedSessionLongContextNotice(messages.length);
      embedBrowserContext = await buildSclawBrowserEmbedContextForSend({
        runtimeId: embedRuntime.runtimeId,
        appTitle: embedRuntime.appTitle,
        fallbackUrl: embedRuntime.fallbackUrl,
      });
    } else {
      textForGateway = [
        '[系统提示：未能绑定左侧应用广场内置浏览器（embed runtime 未就绪）。',
        '浏览器 bridge/ba 工具暂不可用；请勿声称已在左侧页面完成操作。',
        '请确认左侧页面加载完成、AI 助手与当前浏览器 tab 同属一个应用后再试。]',
        '',
        textForGateway,
      ].join('\n');
    }
  }

  const {
    appendSclawBrowserEmbedContext,
    stripSclawBrowserEmbedContextForDisplay,
  } = await import('@/lib/sclaw-browser-embed-context');
  const quoteSkillActive = hasQuoteAssistantSkill(skillMetas);
  const messageWithEmbedContext = appendSclawBrowserEmbedContext(textForGateway, embedBrowserContext, {
    longSessionNotice: embedLongSessionNotice,
    quoteSkillActive,
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
