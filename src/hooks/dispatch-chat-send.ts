/**
 * Unified chat send dispatcher: workflow (slash / NL) then normal chat.
 * Used by Chat page and Home hub so behavior stays consistent.
 */
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useMessageQueueStore } from '@/stores/message-queue';
import { invokeApi } from '@/lib/api-client';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export interface DispatchChatSendOptions {
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  dingTalkMentions?: DingTalkMention[];
  workflowId?: string | null;
  /** Skip question:split (e.g. when @mentions are present). */
  skipQuestionSplit?: boolean;
  onSplittingChange?: (splitting: boolean) => void;
}

export async function dispatchChatSend(options: DispatchChatSendOptions): Promise<void> {
  const {
    text,
    attachments,
    targetAgentId,
    dingTalkMentions,
    workflowId,
    skipQuestionSplit = false,
    onSplittingChange,
  } = options;

  const sendMessage = useChatStore.getState().sendMessage;
  const trimmed = text.trim();

  const chatStateEarly = useChatStore.getState();

  // Start saved workflow (POST /workflows/{id}/start) — before create/template search.
  if (!workflowId && trimmed) {
    const { tryStartRememberedWorkflowSend } = await import('@/hooks/use-workflow-send');
    const started = await tryStartRememberedWorkflowSend({
      text,
      context: {
        sessionKey: chatStateEarly.currentSessionKey,
        agentId: chatStateEarly.currentAgentId,
      },
      sendMessage: async (textToSend, runId, wfId) => {
        await sendMessage({
          text: textToSend,
          attachments,
          targetAgentId,
          dingTalkMentions,
          workflowId: wfId || undefined,
          runId: runId || undefined,
        });
      },
    });
    if (started) return;
  }

  const { isNewWorkflowCreationIntent } = await import('@/hooks/use-workflow-intent');

  // Fresh workflow draft — template search → form → POST create.
  if (!workflowId && trimmed && isNewWorkflowCreationIntent(trimmed)) {
    const chatState = useChatStore.getState();
    chatState.clearPendingWorkflow();
    chatState.clearPendingTemplateSelection();
    const { tryNaturalLanguageWorkflowSend } = await import('@/hooks/use-workflow-send');
    const nlHandled = await tryNaturalLanguageWorkflowSend({
      text,
      context: {
        sessionKey: chatState.currentSessionKey,
        agentId: chatState.currentAgentId,
      },
      sendMessage: async (textToSend, _runId, wfId, ctx) => {
        await sendMessage({
          text: textToSend,
          attachments,
          targetAgentId,
          dingTalkMentions,
          workflowId: wfId || undefined,
          workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
        });
      },
    });
    if (nlHandled) return;
    // Explicit creation intent should not fall through to normal AI chat.
    return;
  }

  const chatState = useChatStore.getState();

  const { tryResolvePendingWorkflow } = await import('@/hooks/use-workflow-send');
  const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
    await sendMessage({ text: msg, attachments, targetAgentId, dingTalkMentions, workflowId: wfId, runId });
  });
  if (resolved) return;

  if (workflowId) {
    const { sendWithWorkflow } = await import('@/hooks/use-workflow-send');
    const ok = await sendWithWorkflow(text, workflowId, {
      sessionKey: chatState.currentSessionKey,
      agentId: chatState.currentAgentId,
    }, async (textToSend, _runId, wfId, ctx) => {
      await sendMessage({
        text: textToSend,
        attachments,
        targetAgentId,
        dingTalkMentions,
        workflowId: wfId || undefined,
        workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
      });
    });
    if (!ok) return;
    return;
  }

  if (!chatState.pendingWorkflow) {
    const { tryNaturalLanguageWorkflowSend } = await import('@/hooks/use-workflow-send');
    const nlHandled = await tryNaturalLanguageWorkflowSend({
      text,
      context: {
        sessionKey: chatState.currentSessionKey,
        agentId: chatState.currentAgentId,
      },
      sendMessage: async (textToSend, _runId, wfId, ctx) => {
        await sendMessage({
          text: textToSend,
          attachments,
          targetAgentId,
          dingTalkMentions,
          workflowId: wfId || undefined,
          workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
        });
      },
    });
    if (nlHandled) return;
  }

  let parts: Array<{ type: string; context: string }> | null = null;
  if (!skipQuestionSplit) {
    onSplittingChange?.(true);
    try {
      const { currentAgentId, currentSessionKey } = useChatStore.getState();
      parts = await invokeApi<Array<{ type: string; context: string }>>('question:split', {
        prompt: text,
        agentId: currentAgentId,
        sessionId: currentSessionKey,
      });
    } catch {
      // Silent fallback
    } finally {
      onSplittingChange?.(false);
    }
  }

  const failed = () => Boolean(useChatStore.getState().error);

  if (parts && parts.length > 1) {
    await sendMessage({ text: parts[0].context, attachments, targetAgentId, dingTalkMentions });
    if (failed()) {
      toast.error('发送失败，请重试');
      return;
    }
    const { currentSessionKey } = useChatStore.getState();
    for (let i = 1; i < parts.length; i++) {
      useMessageQueueStore.getState().enqueue(currentSessionKey, parts[i].context, undefined, targetAgentId);
    }
  } else {
    await sendMessage({ text, attachments, targetAgentId, dingTalkMentions });
    if (failed()) {
      toast.error('发送失败，请重试');
    }
  }
}
