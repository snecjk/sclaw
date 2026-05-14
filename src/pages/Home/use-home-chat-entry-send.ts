import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useMessageQueueStore } from '@/stores/message-queue';
import { invokeApi } from '@/lib/api-client';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

/**
 * 首页入口（省区工作台 / Agent Hub）与聊天页一致的发送路径：
 * 先 newSession（新对话），再 question:split，再 sendMessage；支持附件与队列。
 */
export function useHomeChatEntrySend() {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sendMessage = useChatStore((s) => s.sendMessage);
  const newSession = useChatStore((s) => s.newSession);

  const handleHubQueue = useCallback(
    (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
      useMessageQueueStore.getState().enqueue(text, attachments, targetAgentId);
    },
    [],
  );

  const handleHubSend = useCallback(
    async (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
      if (!isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }
      newSession();

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
        await sendMessage(parts[0].context, attachments, targetAgentId);
        if (failed()) {
          toast.error(t('assistant.sendFailed'));
          return;
        }
        for (let i = 1; i < parts.length; i++) {
          useMessageQueueStore.getState().enqueue(parts[i].context, undefined, targetAgentId);
        }
      } else {
        await sendMessage(text, attachments, targetAgentId);
        if (failed()) {
          toast.error(t('assistant.sendFailed'));
          return;
        }
      }

      navigate('/chat');
    },
    [isGatewayRunning, navigate, newSession, sendMessage, t],
  );

  return {
    handleHubSend,
    handleHubQueue,
  };
}
