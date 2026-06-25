/**
 * WorkflowComposer - 工作流列表 Hero 输入区
 *
 * 与首页 HomeComposer、对话页 ChatInput（composerLayout=home）共用同一套输入复合框：
 * 附件 / @提及 / 引擎·模型选择 / 圆角 22px 壳层。
 * 使用位置：src/pages/Workflow/components/workflow-dashboard.tsx
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { stoParameterFormDockLayout } from '@/lib/surfaces';
import { ChatInput, type FileAttachment } from '@/pages/Chat/ChatInput';
import { ParameterFormDock } from '@/components/parameter-form/ParameterFormDock';
import { ChatEngineSelector, ChatModelSelector } from '@/pages/Chat/ChatEngineModelSelectors';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export interface WorkflowComposerProps {
  /** 快捷 chip 或外部填入的一次性种子文案 */
  seedText?: string;
  /** 用户点击发送后触发（跳转创建工作流向导） */
  onGenerate: (prompt: string) => void;
  /** 样式覆盖（透传给根 div） */
  className?: string;
}

export function WorkflowComposer({ seedText, onGenerate, className }: WorkflowComposerProps) {
  const { t } = useTranslation('workflow');
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const resolvedEngineType =
    currentSessionKey === DEFAULT_SESSION_KEY
      ? currentAgent?.engineType
      : currentSession?.engineType ?? currentAgent?.engineType;
  const requiresGateway = resolvedEngineType !== 'claude';

  const handleGenerateSend = useCallback(
    (
      text: string,
      _attachments?: FileAttachment[],
      _targetAgentId?: string | null,
      _dingTalkMentions?: DingTalkMention[],
      _workflowId?: string | null,
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onGenerate(trimmed);
    },
    [onGenerate],
  );

  const inlineToolbarSelectors = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ChatEngineSelector variant="inline" className="min-w-0 flex-1" />
      <ChatModelSelector variant="inline" className="min-w-0 flex-1" />
    </div>
  );

  return (
    <div className={cn('flex flex-col', className)}>
      <ParameterFormDock layout={stoParameterFormDockLayout('home')} />
      <section className="flex flex-col" aria-label={t('generate.sendAria')}>
        <ChatInput
          onSend={handleGenerateSend}
          onQueue={handleGenerateSend}
          disabled={requiresGateway && !isGatewayRunning}
          sending={false}
          variant="embedded"
          seedText={seedText}
          placeholder={t('generate.placeholder')}
          composerLayout="home"
          toolbarInlineSelectors={inlineToolbarSelectors}
          engineType={resolvedEngineType}
        />
      </section>
    </div>
  );
}
