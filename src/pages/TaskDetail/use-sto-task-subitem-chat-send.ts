import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useMessageQueueStore } from '@/stores/message-queue';
import { invokeApi } from '@/lib/api-client';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

/**
 * Task subitem chat: same send path as home hub but **no** `newSession()` and **no** `/chat` navigation.
 */
export function useStoTaskSubitemChatSend() {
  const { t } = useTranslation('home');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sendMessage = useChatStore((s) => s.sendMessage);

  const handleQueue = useCallback(
    (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
      const { currentSessionKey } = useChatStore.getState();
      useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId);
    },
    [],
  );

  const handleSend = useCallback(
    async (
      text: string,
      attachments?: FileAttachment[],
      targetAgentId?: string | null,
      _dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[],
      workflowId?: string | null,
    ) => {
      if (!isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      const chatState = useChatStore.getState();
      const pending = chatState.pendingWorkflow;

      // Handle pending workflow confirmation
      if (pending && !workflowId) {
        const { tryResolvePendingWorkflow } = await import('@/hooks/use-workflow-send');
        const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
          await sendMessage({ text: msg, attachments, targetAgentId, workflowId: wfId, runId });
        });
        if (resolved) return;
      }

      // If workflow already created in sendWithWorkflow — just start it
      if (pending?.workflowId && workflowId === pending.workflowId) {
        const { startExistingWorkflow } = await import('@/hooks/use-workflow-send');
        const inputs = pending.collectedInputs ?? {};
        const ok = await startExistingWorkflow(
          pending.workflowId,
          inputs,
          { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
          async (msg, runId, wfId) => {
            await sendMessage({ text: msg, attachments, targetAgentId, workflowId: wfId, runId });
          },
          text,
        );
        if (!ok) return;
        return;
      }

      let parts: Array<{ type: string; context: string }> | null = null;
      try {
        const { currentAgentId: agentId, currentSessionKey } = useChatStore.getState();
        parts = await invokeApi<Array<{ type: string; context: string }>>('question:split', {
          prompt: text,
          agentId: agentId,
          sessionId: currentSessionKey,
        });
      } catch {
        // Silent fallback — same as Chat page
      }

      const failed = () => Boolean(useChatStore.getState().error);

      if (parts && parts.length > 1) {
        await sendMessage({ text: parts[0].context, attachments, targetAgentId });
        if (failed()) {
          toast.error(t('assistant.sendFailed'));
          return;
        }
        const { currentSessionKey } = useChatStore.getState();
        for (let i = 1; i < parts.length; i++) {
          useMessageQueueStore.getState().enqueue(currentSessionKey, parts[i].context, undefined, targetAgentId);
        }
      } else {
        await sendMessage({ text, attachments, targetAgentId });
        if (failed()) {
          toast.error(t('assistant.sendFailed'));
          return;
        }
      }
    },
    [isGatewayRunning, sendMessage, t],
  );

  return { handleSend, handleQueue };
}
