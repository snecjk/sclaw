/**
 * ChatProcessBlock — 思考/工具过程块通用壳（MasterGo 4:2177）
 *
 * 结构：标题行（icon + 文案 + 可选 chevron）+ 可选左竖线内容区。
 * 思考面板内 `collapsible` 仅流式中启用；结束后平铺展开、无 chevron。
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProcessBlockCollapse } from '@/hooks/use-process-block-collapse';
import {
  chatProcessContentTextWrapClass,
  chatProcessIconRailClass,
  chatProcessIconRailLineClass,
  chatProcessContentLeadOffsetClass,
  chatProcessSecondaryTextClass,
  chatProcessTitleRowClass,
  chatToolCallShellClass,
} from '@/lib/surfaces';
import { resolveProcessHeaderLayout } from '@/components/chat/process-rail-layout';

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
  /** 思考面板：标题行可折叠 + chevron */
  collapsible?: boolean;
  /** 该 timeline 段已结束 */
  isComplete?: boolean;
  /** 流式且未完成时自动展开 */
  autoExpand?: boolean;
  /** 当前活跃段：标题 shimmer（§6.1） */
  isActive?: boolean;
  /** 左竖线内容区；省略则仅标题行（连接/等待态） */
  children?: React.ReactNode;
  className?: string;
}

export function ChatProcessBlock({
  title,
  icon: Icon,
  isRunning = false,
  collapsible = false,
  isComplete = false,
  autoExpand = false,
  isActive = false,
  children,
  className,
}: ChatProcessBlockProps) {
  const {
    wrapperRef,
    expanded,
    toggle,
    bodyGridClass,
    chevronClass,
  } = useProcessBlockCollapse({
    collapsible,
    isComplete,
    autoExpand,
  });

  const titleWithChevron = collapsible ? (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn(
          'truncate',
          isActive && 'chat-interaction-shimmer-text',
        )}
      >
        {title}
      </span>
      <ChevronDown className={chevronClass} aria-hidden />
    </span>
  ) : (
    <span className="min-w-0 truncate">{title}</span>
  );

  const headerRow = collapsible ? (
    <button
      type="button"
      className={cn(
        chatProcessTitleRowClass,
        'w-full text-left transition-colors duration-150 hover:text-foreground',
      )}
      onClick={toggle}
      aria-expanded={expanded}
    >
      <Icon
        className="h-4 w-4 shrink-0 opacity-70 dark:text-[var(--sto-icon-secondary)] dark:opacity-100"
        aria-hidden
      />
      {titleWithChevron}
    </button>
  ) : (
    <div className={chatProcessTitleRowClass}>
      {isRunning ? (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin opacity-70 dark:text-[var(--sto-icon-secondary)] dark:opacity-100"
          aria-hidden
        />
      ) : null}
      <Icon
        className="h-4 w-4 shrink-0 opacity-70 dark:text-[var(--sto-icon-secondary)] dark:opacity-100"
        aria-hidden
      />
      {titleWithChevron}
    </div>
  );

  const body =
    children != null ? (
      <ChatProcessContentRail
        hasLeadingOffset={
          resolveProcessHeaderLayout(
            collapsible
              ? 'collapsible_chevron_after_icon'
              : isRunning
                ? 'running_spinner_before_icon'
                : 'readonly_title',
          ).hasLeadingControlBeforeSemanticIcon
        }
      >
        {children}
      </ChatProcessContentRail>
    ) : null;

  return (
    <div
      ref={collapsible ? wrapperRef : undefined}
      className={cn(
        chatToolCallShellClass,
        // A1 样式：收起时去掉 header/body 间距，避免一级摘要折叠后留白
        collapsible && !expanded && 'gap-0',
        className,
      )}
    >
      {headerRow}
      {body != null && collapsible ? (
        <div className={bodyGridClass}>
          <div className="min-h-0 overflow-hidden">{body}</div>
        </div>
      ) : body}
    </div>
  );
}

/** 过程块内容区默认正文样式（13px 灰色） */
export const chatProcessBlockBodyClass = chatProcessSecondaryTextClass;
