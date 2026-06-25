import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useMessageQueueStore } from '@/stores/message-queue';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';

/**
 * 首页入口（省区工作台 / Agent Hub）与聊天页保持一致：
 * 在首页默认主会话首次发送时创建一个真实会话，之后追问都复用当前会话。
 * 模型选择通过 pendingNewSessionModel → newSession → applyWorkspaceDefaultToNewSession 落盘。
 */
export function useHomeChatEntrySend() {
  const { t } = useTranslation('home');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const agents = useAgentsStore((s) => s.agents);
  const newSession = useChatStore((s) => s.newSession);

  const handleHubQueue = useCallback(
    (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, _dingTalkMentions?: DingTalkMention[], workflowId?: string | null) => {
      const { currentSessionKey } = useChatStore.getState();
      useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, _dingTalkMentions, workflowId);
    },
    [],
  );

  const handleHubSend = useCallback(
    async (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, _dingTalkMentions?: DingTalkMention[], workflowId?: string | null) => {
      const { currentAgentId, currentSessionKey, sessions } = useChatStore.getState();
      const currentSession = sessions.find((session) => session.key === currentSessionKey);
      const targetEngineType = targetAgentId
        ? (agents ?? []).find((agent) => agent.id === targetAgentId)?.engineType ?? 'openclaw'
        : currentSessionKey === DEFAULT_SESSION_KEY
          ? (agents ?? []).find((agent) => agent.id === currentAgentId)?.engineType ?? 'openclaw'
          : currentSession?.engineType
          ?? (agents ?? []).find((agent) => agent.id === currentAgentId)?.engineType
          ?? 'openclaw';
      if (targetEngineType !== 'claude' && !isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      if (currentSessionKey === DEFAULT_SESSION_KEY) {
        newSession();
      }

      const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
      await dispatchChatSend({ text, attachments, targetAgentId, dingTalkMentions: _dingTalkMentions, workflowId });
      if (useChatStore.getState().error) {
        toast.error(t('assistant.sendFailed'));
      }
    },
    [agents, isGatewayRunning, newSession, t],
  );

  return {
    handleHubSend,
    handleHubQueue,
  };
}
