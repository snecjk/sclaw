/**
 * SidebarHeaderToggle — 省区侧栏折叠/展开（MasterGo 头部面板图标）。
 *
 * 展开态：PanelLeftClose，位于侧栏列顶行右上；
 * 收起态：PanelLeft，浮动于交通灯右侧（AppShellChromeOverlay）。
 */
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SidebarHeaderToggleProps {
  /** 侧栏是否处于收起/完全隐藏态 */
  isCollapsed: boolean;
  /** 点击切换展开/收起 */
  onToggle: () => void;
  /** 收起操作的无障碍文案 */
  collapseLabel: string;
  /** 展开操作的无障碍文案 */
  expandLabel: string;
  className?: string;
}

export function SidebarHeaderToggle({
  isCollapsed,
  onToggle,
  collapseLabel,
  expandLabel,
  className,
}: SidebarHeaderToggleProps) {
  const label = isCollapsed ? expandLabel : collapseLabel;
  const Icon = isCollapsed ? PanelLeft : PanelLeftClose;

  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={label}
      title={label}
      data-sclaw-browser-sidebar-preserve="true"
      onClick={onToggle}
      className={cn(
        'no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#86909C]',
        'transition-colors hover:bg-black/[0.04] hover:text-[#4E5969]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
