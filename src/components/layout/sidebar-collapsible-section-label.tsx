import type { ReactNode, RefObject } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  sidebarSectionChevronClass,
  sidebarSectionLabelClass,
  sidebarSectionStickyShellClass,
} from '@/lib/surfaces';

/**
 * SidebarCollapsibleSectionLabel — 侧栏分区标题（项目 / 任务 / 最近 / 工作台）
 *
 * 主 toggle 占满右侧 actions 以外宽度；actions 不得嵌套在主 button 内，也不得触发 onToggle。
 * 整行容器承担 hover 背景；传入 stickyTopClass 时才启用 sticky 实底壳。
 */
export interface SidebarCollapsibleSectionLabelProps {
  /** 分区是否展开（驱动 chevron + aria-expanded） */
  open: boolean;
  /** 点击主热区切换分区展开 */
  onToggle: () => void;
  /** 分区标题文案 */
  label: string;
  /** 主 toggle 的无障碍名称 */
  toggleAriaLabel: string;
  /** sticky 外壳 ref（滚动自动收起检测） */
  shellRef?: RefObject<HTMLDivElement | null>;
  /** sticky top / z-index；省略则不 sticky（如工作台在 nav 内） */
  stickyTopClass?: string;
  /** 外壳额外 class（如分区间距） */
  className?: string;
  /** 右侧独立操作（批量展开收起、新建等），点击不得触发 onToggle */
  actions?: ReactNode;
}

export function SidebarCollapsibleSectionLabel({
  open,
  onToggle,
  label,
  toggleAriaLabel,
  shellRef,
  stickyTopClass,
  className,
  actions,
}: SidebarCollapsibleSectionLabelProps) {
  return (
    <div
      ref={shellRef}
      className={cn(
        stickyTopClass ? sidebarSectionStickyShellClass : null,
        stickyTopClass,
        className,
      )}
    >
      {/* hover 背景挂在整行：覆盖主 toggle + 右侧 actions */}
      <div
        className={cn(
          'group/sto-sidebar-section-toggle flex h-8 w-full items-center gap-1 rounded-lg transition-colors',
          'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={toggleAriaLabel}
          onClick={onToggle}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center rounded-lg px-[10px] py-[5px] text-left outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            sidebarSectionLabelClass,
          )}
        >
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <span className="min-w-0 truncate">{label}</span>
            <span className={sidebarSectionChevronClass} aria-hidden>
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </span>
          </span>
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-0.5 pr-1">{actions}</div> : null}
      </div>
    </div>
  );
}
