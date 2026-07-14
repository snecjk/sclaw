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
import { hostApiFetch } from '@/lib/host-api';
import { resolveHomePageCarryoverModel } from '@/lib/chat-model-options';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';

/**
 * 首页入口（省区工作台 / Agent Hub）与聊天页保持一致：
 * 在首页默认主会话首次发送时创建一个真实会话，之后追问都复用当前会话。
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
    async (
      text: string,
      attachments?: FileAttachment[],
      targetAgentId?: string | null,
      _dingTalkMentions?: DingTalkMention[],
      workflowId?: string | null,
      workflowSource?: string | null,
      workflowName?: string | null,
    ) => {
      const { currentAgentId, currentSessionKey, sessions, messages } = useChatStore.getState();
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
      if (targetEngineType !== 'claude' && !isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      if (currentSessionKey === DEFAULT_SESSION_KEY) {
        // Capture home page model BEFORE newSession (Claude may only live on agent until upsert)
        const homeAgent = (agents ?? []).find((agent) => agent.id === currentAgentId);
        const homePageModel = resolveHomePageCarryoverModel({
          sessionKey: DEFAULT_SESSION_KEY,
          sessions,
          agentEngineType: homeAgent?.engineType,
          agentModelDisplay: homeAgent?.modelDisplay,
        });
        newSession();
        // Persist the home page model to the new session BEFORE sending the message,
        // so the Gateway uses the correct model.
        if (homePageModel) {
          const { currentSessionKey: newKey, currentAgentId: newAgentId } = useChatStore.getState();
          try {
            if (targetEngineType === 'claude' && newAgentId) {
              // Claude engine: model is agent-scoped, set via /api/agents/{id}/model
              await hostApiFetch(`/api/agents/${encodeURIComponent(newAgentId)}/model`, {
                method: 'PUT',
                body: JSON.stringify({ model: homePageModel }),
              });
              // Update agent store so UI reflects the change
              void useAgentsStore.getState().fetchAgents();
            } else {
              // OpenClaw engine: model is session-scoped
              await hostApiFetch('/api/sessions/model', {
                method: 'POST',
                body: JSON.stringify({
                  sessionKey: newKey,
                  model: homePageModel,
                  engineType: 'openclaw',
                }),
              });
            }
            // Update local session so the UI stays in sync
            useChatStore.setState((state) => ({
              sessions: state.sessions.map((session) => (
                session.key === newKey ? { ...session, model: homePageModel } : session
              )),
            }));
          } catch {
            // Non-blocking: proceed with message send even if model persist fails
          }
        }
      }

      const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
      await dispatchChatSend({ text, attachments, targetAgentId, dingTalkMentions: _dingTalkMentions, workflowId, workflowSource, workflowName });
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
