/**
 * ChatConversationColumn - 对话列统一布局壳
 *
 * 用途：Chat / 首页会话 / 任务子项三栏左栏结构一致；
 * 双栏与三栏共用同一套 862px（page）/ 780px（home）阅读宽度轨，避免三栏时 flex stretch 撑满。
 *
 * 使用位置：src/pages/Chat、HomeMainConversation、TaskSubitemChatSurface
 */
import { cn } from '@/lib/utils';
import {
  stoChatColumnClass,
  stoSplitChatPaneClass,
  stoSplitChatPaneContentWrapClass,
  type StoChatColumnVariant,
} from '@/lib/surfaces';

export interface ChatConversationColumnProps {
  /** page = 862px；home = 780px */
  variant: StoChatColumnVariant;
  /** 是否处于三栏预览布局 */
  isSplitLayout: boolean;
  /** 传给限宽对话列的额外 class */
  className?: string;
  children: React.ReactNode;
}

export function ChatConversationColumn({
  variant,
  isSplitLayout,
  className,
  children,
}: ChatConversationColumnProps) {
  return (
    <div className={stoSplitChatPaneClass}>
      <div className={stoSplitChatPaneContentWrapClass(isSplitLayout)}>
        <div className={cn(stoChatColumnClass(variant, isSplitLayout), className)}>
          {children}
        </div>
      </div>
    </div>
  );
}
