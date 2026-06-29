/**
 * SidebarRunningIcon — 侧栏会话「运行中」loading 图标（loading.svg）。
 *
 * 使用位置：Sidebar 最近列表、Legacy bucket 会话行。
 */
import loadingSvg from '@/assets/loading.svg';
import { cn } from '@/lib/utils';

export interface SidebarRunningIconProps {
  /** 紧凑模式（折叠侧栏图标列） */
  isCompact?: boolean;
  /** 可选样式覆盖 */
  className?: string;
  /** 无障碍标签；不传则视为装饰图标 */
  ariaLabel?: string;
}

export function SidebarRunningIcon({
  isCompact = false,
  className,
  ariaLabel,
}: SidebarRunningIconProps) {
  const size = isCompact ? 12 : 14;

  return (
    <img
      src={loadingSvg}
      alt=""
      width={size}
      height={size}
      className={cn(
        'shrink-0 animate-spin',
        isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5',
        className,
      )}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
    />
  );
}
