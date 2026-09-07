/**
 * WorkflowComposer - 工作流列表 Hero 输入区
 *
 * 使用 Workflow 专用输入框（无底栏工具行，仅右下角发送箭头），
 * 与首页 HomeComposer、对话页 ChatInput 解耦，互不影响。
 *
 * 注意：不渲染 ParameterFormDock——工作流列表页无 chat session 上下文，
 * 参数表单属于对话区运行场景，不应在此展示。
 * 使用位置：src/pages/Workflow/components/workflow-dashboard.tsx
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { WorkflowComposerInput } from '@/pages/Workflow/components/workflow-composer-input';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { chatEngineRequiresGateway } from '@/hooks/use-chat-input-bindings';

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
  const requiresGateway = chatEngineRequiresGateway(resolvedEngineType);

  const handleGenerateSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onGenerate(trimmed);
    },
    [onGenerate],
  );

  return (
    <div className={cn('flex flex-col', className)}>
      <section className="flex flex-col" aria-label={t('generate.sendAria')}>
        <WorkflowComposerInput
          onSend={handleGenerateSend}
          disabled={requiresGateway && !isGatewayRunning}
          seedText={seedText}
          placeholder={t('generate.placeholder')}
        />
      </section>
    </div>
  );
}
