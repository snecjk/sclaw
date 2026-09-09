/**
 * ChatConversationColumn - 对话列统一布局壳
 *
 * 用途：Chat / 首页会话 / 任务子项三栏左栏结构一致；
 * 双栏与三栏共用同一套列内内容宽（page 862px / home 780px）阅读轨，避免三栏时 flex stretch 撑满。
 * PreviewMode.expanded 时保持挂载（hidden + inert），禁止卸载以免丢失草稿/scrollTop。
 *
 * 使用位置：src/pages/Chat、HomeMainConversation
 */
import { cn } from '@/lib/utils';
import {
  stoSplitChatPaneClass,
  stoSplitChatPaneContentWrapClass,
  type StoChatColumnVariant,
} from '@/lib/surfaces';

export interface ChatConversationColumnProps {
  /** page = 列内内容 862px；home = 列内内容 780px */
  variant: StoChatColumnVariant;
  /** 是否处于三栏 split 预览布局 */
  isSplitLayout: boolean;
  /**
   * PreviewMode.expanded：布局隐藏但保持 React 挂载。
   * 禁止用 Portal / position:fixed / DOM Fullscreen 代替。
   */
  isPreviewExpanded?: boolean;
  /** 三栏统一 grid：对话列 row2 col1 定位（传 {@link stoSplitGridBodyChatClass}） */
  splitGridChatClass?: string;
  /** 传给限宽对话列的额外 class */
  className?: string;
  children: React.ReactNode;
}

export function ChatConversationColumn({
  variant: _variant,
  isSplitLayout,
  isPreviewExpanded = false,
  splitGridChatClass,
  className,
  children,
}: ChatConversationColumnProps) {
  return (
    <div
      data-preview-background
      className={cn(
        stoSplitChatPaneClass,
        splitGridChatClass,
        isPreviewExpanded && 'hidden',
        className,
      )}
      aria-hidden={isPreviewExpanded || undefined}
      // React 19：inert 防止焦点落入隐藏对话列
      {...(isPreviewExpanded ? { inert: true as const } : {})}
    >
      <div className={stoSplitChatPaneContentWrapClass(isSplitLayout && !isPreviewExpanded)}>
        {children}
      </div>
    </div>
  );
}
