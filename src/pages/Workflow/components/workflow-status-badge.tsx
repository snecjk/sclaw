import { cn } from '@/lib/utils';

/** 工作流状态 pill 共用结构（标题行「已开启 / 已暂停」等） */
export const workflowStatusBadgeShellClass =
  'inline-flex shrink-0 rounded-md px-1.5 py-1 text-xs font-medium leading-[14px]';

export type WorkflowStatusBadgeVariant = 'on' | 'off';

const WORKFLOW_STATUS_BADGE_VARIANT_CLASS: Record<
  WorkflowStatusBadgeVariant,
  { bgClassName: string; textClassName: string }
> = {
  on: {
    bgClassName: 'bg-[var(--sto-wf-detail-status-on-bg)]',
    textClassName: 'text-[var(--sto-wf-detail-status-on-text)]',
  },
  off: {
    bgClassName: 'bg-[var(--sto-wf-detail-status-off-bg)]',
    textClassName: 'text-[var(--sto-wf-detail-status-off-text)]',
  },
};

interface WorkflowStatusBadgeProps {
  children: React.ReactNode;
  /** 预设配色：on = 已开启绿，off = 已暂停灰 */
  variant?: WorkflowStatusBadgeVariant;
  /** 自定义背景色 class（覆盖 variant） */
  bgClassName?: string;
  /** 自定义文字色 class（覆盖 variant） */
  textClassName?: string;
  className?: string;
}

/**
 * 工作流标题行状态 pill：结构固定，颜色通过 variant 或 bg/text className 配置。
 */
export function WorkflowStatusBadge({
  children,
  variant,
  bgClassName,
  textClassName,
  className,
}: WorkflowStatusBadgeProps) {
  const preset = variant ? WORKFLOW_STATUS_BADGE_VARIANT_CLASS[variant] : null;

  return (
    <span
      className={cn(
        workflowStatusBadgeShellClass,
        bgClassName ?? preset?.bgClassName,
        textClassName ?? preset?.textClassName,
        className,
      )}
    >
      {children}
    </span>
  );
}
