import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useMessageQueueStore } from '@/stores/message-queue';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import { getCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { chatEngineRequiresGateway } from '@/hooks/use-chat-input-bindings';

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

  const handleHubQueue = useCallback(
    (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, _dingTalkMentions?: DingTalkMention[], workflowId?: string | null, skillMeta?: SkillMeta, extras?: import('@/pages/Chat/ChatInput').ChatSendExtras) => {
      const { currentSessionKey } = useChatStore.getState();
      useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, _dingTalkMentions, workflowId, skillMeta, extras);
    },
    [],
  );

  const handleHubSend = useCallback(
    async (
      text: string,
      attachments?: FileAttachment[],
      targetAgentId?: string | null,
      _dingTalkMentions?: DingTalkMention[],
      workflowId?: string | null,
      workflowSource?: string | null,
      workflowName?: string | null,
      skillMeta?: SkillMeta,
      extras?: import('@/pages/Chat/ChatInput').ChatSendExtras,
    ) => {
      const { currentAgentId, currentSessionKey, sessions } = useChatStore.getState();
      const messages = getCurrentChatDisplayMessages();
      const currentSession = sessions.find((session) => session.key === currentSessionKey);
      const agentEngineType = (agents ?? []).find((agent) => agent.id === (targetAgentId || currentAgentId))?.engineType
        ?? 'openclaw';
      const targetEngineType = targetAgentId
        ? agentEngineType
        : resolveChatSessionEngineType(
          currentSession,
          agentEngineType,
          currentSessionKey,
          { messageCount: messages.length },
        );
      if (chatEngineRequiresGateway(targetEngineType) && !isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
      await dispatchChatSend({
        text,
        attachments,
        targetAgentId,
        dingTalkMentions: _dingTalkMentions,
        workflowId,
        workflowSource,
        workflowName,
        skillMeta,
        skillMetas: extras?.skillMetas,
        workflows: extras?.workflows,
        composerSegments: extras?.composerSegments,
        gatewayText: extras?.gatewayText,
        composition: extras?.composition,
        workflowExecutionEngine: extras?.workflowExecutionEngine,
      });
    },
    [agents, isGatewayRunning, t],
  );

  return {
    handleHubSend,
    handleHubQueue,
  };
}
