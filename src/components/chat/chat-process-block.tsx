/**
 * ChatProcessBlock — 思考/工具过程块通用壳（MasterGo 4:2177）
 *
 * 结构：标题行（icon + 文案）+ 可选左竖线内容区。
 * 竖线在 16px icon 列内水平居中，与标题 icon 对齐。
 */
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  chatProcessContentTextWrapClass,
  chatProcessIconRailClass,
  chatProcessIconRailLineClass,
  chatProcessContentLeadOffsetClass,
  chatProcessSecondaryTextClass,
  chatProcessTitleRowClass,
  chatToolCallShellClass,
} from '@/lib/surfaces';

export interface ChatProcessContentRailProps {
  /** 标题行 icon 前有 chevron/spinner 时，竖线列与 semantic icon 对齐 */
  hasLeadingOffset?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * 过程块内容区：竖线与上方 16px icon 竖向居中对齐（MasterGo divider）。
 */
export function ChatProcessContentRail({
  hasLeadingOffset = false,
  children,
  className,
}: ChatProcessContentRailProps) {
  return (
    <div className={cn('flex min-w-0', className)}>
      {hasLeadingOffset ? (
        <div className={chatProcessContentLeadOffsetClass} aria-hidden />
      ) : null}
      <div className={chatProcessIconRailClass}>
        <div className={chatProcessIconRailLineClass} aria-hidden />
      </div>
      <div className={chatProcessContentTextWrapClass}>{children}</div>
    </div>
  );
}

export interface ChatProcessBlockProps {
  /** 块标题（用户可见，走 i18n 或工具展示名） */
  title: string;
  /** 标题行左侧语义图标 */
  icon: LucideIcon;
  /** 运行中时在图标前展示 spinner */
  isRunning?: boolean;
  /** 左竖线内容区；省略则仅标题行（连接/等待态） */
  children?: React.ReactNode;
  className?: string;
}

export function ChatProcessBlock({
  title,
  icon: Icon,
  isRunning = false,
  children,
  className,
}: ChatProcessBlockProps) {
  return (
    <div className={cn(chatToolCallShellClass, className)}>
      <div className={chatProcessTitleRowClass}>
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" aria-hidden />
        ) : null}
        <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </div>
      {children != null ? (
        <ChatProcessContentRail hasLeadingOffset={isRunning}>{children}</ChatProcessContentRail>
      ) : null}
    </div>
  );
}

/** 过程块内容区默认正文样式（13px 灰色） */
export const chatProcessBlockBodyClass = chatProcessSecondaryTextClass;
