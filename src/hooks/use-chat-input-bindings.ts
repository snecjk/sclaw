/**
 * useChatInputBindings Hook
 *
 * 统一管理 ChatInput 组件的绑定逻辑，减少各页面的重复代码。
 *
 * 统一处理：
 * - Gateway 运行状态检查（仅 openclaw disabled）
 * - 发送中状态（sending）
 * - 停止运行回调（onStop -> abortRun）
 * - 可选的 isEmpty、seedText、className、variant
 *
 * 使用示例：
 *
 * ```tsx
 * // Chat 页面
 * const inputProps = useChatInputBindings({
 *   onSend: handleSend,
 *   onQueue: handleQueue,
 *   isEmpty: messages.length === 0 && !sending,
 * });
 * <ChatInput {...inputProps} />
 *
 * // HomeAgentHubSurface
 * const inputProps = useChatInputBindings({
 *   onSend: handleHubSend,
 *   onQueue: handleHubQueue,
 *   variant: 'embedded',
 *   seedText,
 * });
 * <ChatInput {...inputProps} />
 * ```
 */
import { useMemo } from 'react';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { useGatewayStore } from '@/stores/gateway';
import { suspendAutoSend } from '@/stores/message-queue';
import type { ChatSendExtras, FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';

export interface ChatInputBindingsOptions {
  /** 发送消息回调 */
  onSend: (
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
  /** 排队消息回调 */
  onQueue: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
    extras?: ChatSendExtras,
  ) => void;
  /**
   * 场景标记：`embedded` 表示首页 hub 装配。
   * 不再控制 Gateway 底栏或外层 max-width；排版请用 className。
   */
  variant?: 'default' | 'embedded';
  /** 是否为空会话（控制是否显示欢迎页） */
  isEmpty?: boolean;
  /** 种子文本（用于预填充输入框，如任务子项默认提示） */
  seedText?: string;
  /** 技能广场「使用」：预填技能标签 */
  seedSkillSlug?: string;
  /** 覆盖默认 composer 占位文案 */
  placeholder?: string;
  /** 外层 className */
  className?: string;
  /** 当前输入面板所属引擎；仅 openclaw 依赖 Gateway 在线 */
  engineType?: 'openclaw' | 'claude' | 'pi';
}

export interface ChatInputBindingsResult {
  /** ChatInput onSend 回调 */
  onSend: ChatInputBindingsOptions['onSend'];
  /** ChatInput onStop 回调（自动绑定到 abortRun） */
  onStop: () => void;
  /** ChatInput onQueue 回调 */
  onQueue: ChatInputBindingsOptions['onQueue'];
  /** 是否禁用（基于 Gateway 状态） */
  disabled: boolean;
  /** 是否正在发送 */
  sending: boolean;
  /** 是否空会话 */
  isEmpty?: boolean;
  /** ChatInput 变体 */
  variant: 'default' | 'embedded';
  /** 种子文本 */
  seedText?: string;
  /** 技能广场「使用」：预填技能标签 */
  seedSkillSlug?: string;
  /** 覆盖默认 composer 占位文案 */
  placeholder?: string;
  /** 外层 className */
  className?: string;
}

/** Only OpenClaw chat dispatch is gated by the OpenClaw Gateway lifecycle. */
export function chatEngineRequiresGateway(
  engineType: ChatInputBindingsOptions['engineType'],
): boolean {
  return engineType === 'openclaw';
}

/**
 * 获取 ChatInput 组件的绑定 props。
 *
 * 自动处理：
 * - disabled: 仅 openclaw 基于 Gateway 是否运行
 * - sending: 来自 chat store
 * - onStop: 自动绑定 abortRun
 */
export function useChatInputBindings(options: ChatInputBindingsOptions): ChatInputBindingsResult {
  const abortRun = useChatStore((s) => s.abortRun);
  const { sending } = useCurrentChatRuntimeView();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const requiresGateway = chatEngineRequiresGateway(options.engineType);

  return useMemo(
    () => ({
      onSend: options.onSend,
      onStop: () => {
        // Keep queued messages instead of firing them right after Stop.
        suspendAutoSend();
        void abortRun();
      },
      onQueue: options.onQueue,
      disabled: requiresGateway && !isGatewayRunning,
      sending,
      isEmpty: options.isEmpty,
      variant: options.variant ?? 'default',
      seedText: options.seedText,
      seedSkillSlug: options.seedSkillSlug,
      placeholder: options.placeholder,
      className: options.className,
    }),
    [
      options.onSend,
      options.onQueue,
      options.isEmpty,
      options.variant,
      options.seedText,
      options.seedSkillSlug,
      options.placeholder,
      options.className,
      abortRun,
      requiresGateway,
      isGatewayRunning,
      sending,
    ],
  );
}
