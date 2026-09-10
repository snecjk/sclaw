/**
 * HomeComposer - 三首页统一底部输入区
 *
 * 封装 ChatInput（home 布局）+ 内联引擎/模型 + 底部免责文案。
 * 使用位置：
 * - 未进入会话（Hero/卡片）：各 Surface 底部 footer 唯一实例
 * - 已进入会话：仅由 HomeMainConversation 内嵌渲染（footer 不要再挂一份）
 */
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatDisplayMessageCount } from '@/stores/chat/display-selectors';
import { useMessageQueueStore } from '@/stores/message-queue';
import { cn } from '@/lib/utils';
import {
  stoChatShellHomeClass,
  stoHeroInputShellClass,
  stoParameterFormDockLayout,
} from '@/lib/surfaces';
import { ChatInput, type ChatSendExtras, type FileAttachment } from '@/pages/Chat/ChatInput';
import { PendingQueuePanel } from '@/pages/Chat/PendingQueuePanel';
import { PLAN_GATE_HEADING, buildPlanFirstPrompt } from '@/lib/app-dev-plan-gate';
import { ParameterFormDock } from '@/components/parameter-form/ParameterFormDock';
import { ChatEngineModelPicker } from '@/pages/Chat/ChatEngineModelSelectors';
import { useChatInputBindings } from '@/hooks/use-chat-input-bindings';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { resolveChatSessionEngineType } from '@/lib/resolve-chat-session-engine-type';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import type { AgentSummary } from '@/types/agent';
import { homeHubFooterDisclaimerClass } from './home-hub-surface-styles';

export interface HomeComposerProps {
  /** 一次性填入输入框的种子文案 */
  seedText?: string;
  /** 技能广场「使用」：预填技能标签 */
  seedSkillSlug?: string;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    workflowSource?: string | null,
    workflowName?: string | null,
    skillMeta?: SkillMeta,
    extras?: ChatSendExtras,
  ) => void;
  /** Return true to consume a local command before it is sent to the agent. */
  onBeforeSend?: (text: string) => boolean | string | void;
  onQueue?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
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
  /** 新对话落地页：输入框下展示「进入项目工作」选择条 */
  showProjectPicker?: boolean;
  /** 应用开发工作台：隐藏 @ */
  hideDingTalkMention?: boolean;
  /** 应用开发工作台：接口清单 */
  showInterfaceCatalog?: boolean;
  /** Embed / 业务场景快捷 pill */
  composerScenarioActions?: import('../../../shared/embed-composer-actions').EmbedComposerAction[];
  /** 应用广场窄栏：工具收起到下拉 */
  toolbarToolsLayout?: 'inline' | 'dropdown';
  /** 可选覆盖默认内联引擎/模型工具栏 */
  toolbarSelectors?: ReactNode;
  /** 广场 / 建站：锁定草稿到该会话，不跟随全局 currentSessionKey */
  composerDraftSessionKey?: string | null;
}

export function HomeComposer({
  seedText,
  seedSkillSlug,
  onSend,
  onBeforeSend,
  onQueue,
  placeholder,
  placeholderKey,
  className,
  engineType: engineTypeProp,
  showDisclaimer = true,
  footerAlign = 'center',
  showProjectPicker = false,
  hideDingTalkMention = false,
  showInterfaceCatalog = false,
  composerScenarioActions,
  toolbarToolsLayout,
  toolbarSelectors,
  composerDraftSessionKey,
}: HomeComposerProps) {
  const { t } = useTranslation('home');
  const agents = useAgentsStore((s) => s.agents);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const messagesLength = useCurrentChatDisplayMessageCount();
  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();

  const queue = useMessageQueueStore((s) => s.getQueue(currentSessionKey));
  const queueRemove = useCallback((id: string) => useMessageQueueStore.getState().remove(currentSessionKey, id), [currentSessionKey]);
  const queueMoveUp = useCallback((id: string) => useMessageQueueStore.getState().moveUp(currentSessionKey, id), [currentSessionKey]);
  const queueMoveDown = useCallback((id: string) => useMessageQueueStore.getState().moveDown(currentSessionKey, id), [currentSessionKey]);

  const currentAgent = useMemo(
    () => resolveAgentById(agents, currentAgentId),
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
    { messageCount: messagesLength },
  );

  const inlineToolbarSelectors = toolbarSelectors ?? (
    <ChatEngineModelPicker className="min-w-0 max-w-full" />
  );

  const sendMessage = onSend ?? handleHubSend;
  const inputProps = useChatInputBindings({
    onSend: onBeforeSend
      ? (text, attachments, targetAgentId, dingTalkMentions, workflowId, workflowSource, workflowName, skillMeta, extras) => {
          const gate = onBeforeSend(text);
          if (gate === true) return;
          // 方案闸门只进发给模型的 gatewayText，气泡仍用用户原文。
          if (typeof gate === 'string' && gate.includes(PLAN_GATE_HEADING)) {
            const gatewaySource = extras?.gatewayText?.trim() || text;
            sendMessage(
              text,
              attachments,
              targetAgentId,
              dingTalkMentions,
              workflowId,
              workflowSource,
              workflowName,
              skillMeta,
              { ...extras, gatewayText: buildPlanFirstPrompt(gatewaySource) },
            );
            return;
          }
          const outbound = typeof gate === 'string' ? gate : text;
          sendMessage(
            outbound,
            attachments,
            targetAgentId,
            dingTalkMentions,
            workflowId,
            workflowSource,
            workflowName,
            skillMeta,
            extras,
          );
        }
      : sendMessage,
    onQueue: onQueue ?? handleHubQueue,
    variant: 'embedded',
    seedText,
    seedSkillSlug,
    placeholder: placeholder ?? (placeholderKey ? t(placeholderKey) : undefined),
    engineType: resolvedEngineType,
    className: cn('px-0 pb-0 pt-0', stoChatShellHomeClass),
  });

  return (
    <div className={cn(stoHeroInputShellClass, className)}>
      <ParameterFormDock layout={stoParameterFormDockLayout('home')} />
      <PendingQueuePanel
        sessionKey={currentSessionKey}
        queue={queue}
        onRemove={queueRemove}
        onMoveUp={queueMoveUp}
        onMoveDown={queueMoveDown}
        className={cn(stoChatShellHomeClass, 'px-0')}
      />
      <section className="flex flex-col" aria-label={t('assistant.placeholder')}>
        <ChatInput
          {...inputProps}
          composerLayout="home"
          toolbarInlineSelectors={inlineToolbarSelectors}
          engineType={resolvedEngineType}
          showProjectPicker={showProjectPicker}
          hideDingTalkMention={hideDingTalkMention}
          showInterfaceCatalog={showInterfaceCatalog}
          composerScenarioActions={composerScenarioActions}
          toolbarToolsLayout={toolbarToolsLayout}
          composerDraftSessionKey={composerDraftSessionKey}
        />
      </section>
      {showDisclaimer ? (
        <p
          className={cn(
            'mt-2',
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
