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

const toolbarTooltipClass =
  'overflow-visible border-none bg-[#1D2129] px-2.5 py-1.5 text-xs font-medium text-white shadow-none';

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
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className={toolbarTooltipClass}>
        {label}
        <TooltipArrow className="fill-[#1D2129]" width={10} height={5} />
      </TooltipContent>
    </Tooltip>
  );
}
