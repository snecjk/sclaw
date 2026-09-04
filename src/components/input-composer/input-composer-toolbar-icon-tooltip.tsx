/**
 * 工具栏图标悬停提示（home 布局深色小 tip）。
 *
 * ## Types
 * - 无独立导出类型；props：`{ label: string; children: ReactNode }`
 */
import type { ReactNode } from 'react';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  sidebarTooltipArrowClass,
  sidebarTooltipContentClass,
} from '@/lib/surfaces';

export function InputComposerToolbarIconTooltip({
  label,
  children,
}: {
  /** tip 文案 */
  label: string;
  /** 触发元素（通常为 Button） */
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className={sidebarTooltipContentClass}>
        {label}
        <TooltipArrow className={sidebarTooltipArrowClass} width={10} height={5} />
      </TooltipContent>
    </Tooltip>
  );
}
