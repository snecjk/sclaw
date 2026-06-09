import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useMessageQueueStore } from '@/stores/message-queue';
import { invokeApi } from '@/lib/api-client';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';

/**
 * 首页入口（省区工作台 / Agent Hub）与聊天页保持一致：
 * 在首页默认主会话首次发送时创建一个真实会话，之后追问都复用当前会话。
 */
export function useHomeChatEntrySend() {
  const { t } = useTranslation('home');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sendMessage = useChatStore((s) => s.sendMessage);
  const newSession = useChatStore((s) => s.newSession);

  const handleHubQueue = useCallback(
    (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, _dingTalkMentions?: DingTalkMention[], workflowId?: string | null) => {
      const { currentSessionKey } = useChatStore.getState();
      useMessageQueueStore.getState().enqueue(currentSessionKey, text, attachments, targetAgentId, _dingTalkMentions, workflowId);
    },
    [],
  );

  const handleHubSend = useCallback(
    async (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, _dingTalkMentions?: DingTalkMention[], workflowId?: string | null, workflowContext?: import('@/stores/chat').WorkflowContextBlock | null) => {
      if (!isGatewayRunning) {
        toast.error(t('assistant.gatewayRequired'));
        return;
      }

      // Handle pending workflow confirmation (before fresh workflow selection)
      const { tryResolvePendingWorkflow } = await import('@/hooks/use-workflow-send');
      const resolved = await tryResolvePendingWorkflow(text, async (msg, runId, wfId) => {
        await sendMessage({ text: msg, attachments, targetAgentId, workflowId: wfId, runId });
      });
      if (resolved) return;

      // Handle workflow: same logic as Chat/index.tsx
      if (workflowId) {
        const { sendWithWorkflow } = await import('@/hooks/use-workflow-send');
        // Create new session BEFORE sending workflow to ensure messages are persisted
        const { currentSessionKey, currentAgentId } = useChatStore.getState();
        if (currentSessionKey === DEFAULT_SESSION_KEY) {
          newSession();
        }
        const ok = await sendWithWorkflow(text, workflowId, {
          sessionKey: useChatStore.getState().currentSessionKey,
          agentId: currentAgentId,
        }, async (textToSend, _runId, wfId, ctx) => {
          const wfCtx = ctx as import('@/stores/chat').WorkflowContextBlock | undefined;
          await sendMessage({ text: textToSend, attachments, targetAgentId, workflowId: wfId || undefined, workflowContext: wfCtx });
        });
        if (!ok) return;
        return;
      }

      // ── Natural language workflow intent detection ──
      const { pendingWorkflow } = useChatStore.getState();
      if (!pendingWorkflow && !workflowId) {
        const { currentSessionKey, currentAgentId } = useChatStore.getState();
        if (currentSessionKey === DEFAULT_SESSION_KEY) {
          newSession();
        }
        const { tryNaturalLanguageWorkflowSend } = await import('@/hooks/use-workflow-send');
        const nlHandled = await tryNaturalLanguageWorkflowSend({
          text,
          context: {
            sessionKey: useChatStore.getState().currentSessionKey,
            agentId: currentAgentId,
          },
          sendMessage: async (textToSend, _runId, wfId, ctx) => {
            const wfCtx = ctx as import('@/stores/chat').WorkflowContextBlock | undefined;
            await sendMessage({
              text: textToSend,
              attachments,
              targetAgentId,
              workflowId: wfId || undefined,
              workflowContext: wfCtx,
            });
          },
        });
        if (nlHandled) return;
      }

      const { currentSessionKey } = useChatStore.getState();
      if (currentSessionKey === DEFAULT_SESSION_KEY) {
        newSession();
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
        const { currentSessionKey: sessionKey } = useChatStore.getState();
        for (let i = 1; i < parts.length; i++) {
          useMessageQueueStore.getState().enqueue(sessionKey, parts[i].context, undefined, targetAgentId);
        }
      } else {
        await sendMessage({ text, attachments, targetAgentId });
        if (failed()) {
          toast.error(t('assistant.sendFailed'));
          return;
        }
      }
    },
    [isGatewayRunning, newSession, sendMessage, t],
  );

  return {
    handleHubSend,
    handleHubQueue,
  };
}
