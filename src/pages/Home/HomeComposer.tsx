/**
 * HomeComposer - 三首页统一底部输入区
 *
 * 封装 ChatInput（home 布局）+ 内联引擎/模型 + 底部免责文案。
 * 使用位置：
 * - 未进入会话（Hero/卡片）：各 Surface 底部 footer 唯一实例
 * - 已进入会话：仅由 HomeMainConversation 内嵌渲染（footer 不要再挂一份）
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { stoHeroInputShellClass, stoParameterFormDockLayout } from '@/lib/surfaces';
import { ChatInput, type FileAttachment } from '@/pages/Chat/ChatInput';
import { ParameterFormDock } from '@/components/parameter-form/ParameterFormDock';
import { ChatEngineSelector, ChatModelSelector } from '@/pages/Chat/ChatEngineModelSelectors';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { AgentSummary } from '@/types/agent';
import { homeHubFooterDisclaimerClass } from './home-hub-surface-styles';

export interface HomeComposerProps {
  /** 一次性填入输入框的种子文案 */
  seedText?: string;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => void;
  onQueue?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => void;
  /** 直接覆盖占位文案 */
  placeholder?: string;
  /** home namespace 下的 i18n key（如 site.assistant.placeholder） */
  placeholderKey?: string;
  className?: string;
  engineType?: AgentSummary['engineType'];
  /** 是否展示底部免责（默认 true） */
  showDisclaimer?: boolean;
  /** 免责对齐（三首页统一居中） */
  footerAlign?: 'center' | 'right';
}

export function HomeComposer({
  seedText,
  onSend,
  onQueue,
  placeholder,
  placeholderKey,
  className,
  engineType: engineTypeProp,
  showDisclaimer = true,
  footerAlign = 'center',
}: HomeComposerProps) {
  const { t } = useTranslation('home');
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const error = useChatStore((s) => s.error);
  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();

  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const resolvedEngineType = engineTypeProp ?? resolveChatSessionEngineType(
    currentSession,
    currentAgent?.engineType,
    currentSessionKey,
  );

  const inlineToolbarSelectors = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ChatEngineSelector variant="inline" className="min-w-0 flex-1" />
      <ChatModelSelector variant="inline" className="min-w-0 flex-1" />
    </div>
  );

  const inputProps = useChatInputBindings({
    onSend: onSend ?? handleHubSend,
    onQueue: onQueue ?? handleHubQueue,
    variant: 'embedded',
    seedText,
    placeholder: placeholder ?? (placeholderKey ? t(placeholderKey) : undefined),
    engineType: resolvedEngineType,
  });

  return (
    <div className={cn(stoHeroInputShellClass, className)}>
      <ParameterFormDock layout={stoParameterFormDockLayout('home')} />
      <section className="flex flex-col" aria-label={t('assistant.placeholder')}>
        <ChatInput
          {...inputProps}
          composerLayout="home"
          toolbarInlineSelectors={inlineToolbarSelectors}
          engineType={resolvedEngineType}
        />
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </section>
      {showDisclaimer ? (
        <p
          className={cn(
            'mt-4',
            homeHubFooterDisclaimerClass,
            footerAlign === 'right' ? 'text-right' : 'text-center',
          )}
        >
          {t('assistant.footerDisclaimer')}
        </p>
      ) : null}
    </div>
  );
}
