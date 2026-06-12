import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useMessageQueueStore } from '@/stores/message-queue';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

/**
 * Task subitem chat: same send path as home hub but **no** `newSession()` and **no** `/chat` navigation.
 */
export function useStoTaskSubitemChatSend() {
  const { t } = useTranslation('home');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const agents = useAgentsStore((s) => s.agents);

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
      dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[],
      workflowId?: string | null,
    ) => {
      const { currentAgentId } = useChatStore.getState();
      const targetEngineType = (agents ?? []).find((agent) => agent.id === (targetAgentId || currentAgentId))?.engineType ?? 'openclaw';
      if (targetEngineType !== 'claude' && !isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
      await dispatchChatSend({ text, attachments, targetAgentId, dingTalkMentions, workflowId });
      if (useChatStore.getState().error) {
        toast.error(t('assistant.sendFailed'));
      }
    },
    [agents, isGatewayRunning, t],
  );

  return { handleSend, handleQueue };
}
