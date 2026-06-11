/**
 * Unified chat send dispatcher: workflow UI shortcuts then normal chat (model + builtin tools).
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

  const sendWithWorkflowContext = async (
    textToSend: string,
    _runId?: string | null,
    wfId?: string | null,
    ctx?: unknown,
  ) => {
    await sendMessage({
      text: textToSend,
      attachments,
      targetAgentId,
      dingTalkMentions,
      workflowId: wfId || undefined,
      runId: _runId || undefined,
      workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
    });
  };

  const chatState = useChatStore.getState();

  // Explicit template pick from picker — fetch schema → send to model.
  if (workflowId) {
    if (chatState.pendingWorkflow?.templateId !== workflowId) {
      chatState.clearPendingWorkflow();
    }
    const { sendWithWorkflow } = await import('@/hooks/use-workflow-send');
    const ok = await sendWithWorkflow(text, workflowId, {
      sessionKey: chatState.currentSessionKey,
      agentId: chatState.currentAgentId,
    }, sendWithWorkflowContext);
    if (!ok) return;
    return;
  }

  // In-flight parameter_form confirm / cancel only — creation & search go through model tools.
  const { tryResolvePendingWorkflow } = await import('@/hooks/use-workflow-send');
  const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
    await sendMessage({ text: msg, attachments, targetAgentId, dingTalkMentions, workflowId: wfId, runId });
  });
  if (resolved) return;

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
