/**
 * SidebarBrandHeader — 侧栏顶品牌区（含字 logo + 版本 + 折叠钮）。
 *
 * 省区 Mac：chrome 行（DEV 在红绿灯后 + 折叠）+ 品牌行；
 * 省区 Win / 完整 layout：单行（Win 在版本号后展示 DEV）。
 */
import sidebarLogoSvg from '@/assets/sidebar-logo.svg';
import { cn } from '@/lib/utils';
import { sidebarBrandVersionClass } from '@/lib/surfaces';
import { formatAppDisplayVersion } from '@/lib/format-app-display-version';
import { ChromeEnvBadge } from '@/components/layout/chrome-env-badge';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import type { SidebarLayoutVariant } from '@/lib/sidebar-layout';
import packageJson from '../../../package.json';

/** 与 Sidebar nav 容器一致（展开态 `px-2`） */
const SIDEBAR_BRAND_OUTER_X = 'px-2';
/** 与展开态 NavLink `px-[10px]` 一致，使标题与图标左缘对齐 */
const SIDEBAR_BRAND_INNER_X = 'px-[10px]';

export interface SidebarBrandHeaderProps {
  /** 侧栏 layout 变体（省区 / 完整） */
  layoutVariant: SidebarLayoutVariant;
  /** 点击收起侧栏 */
  onCollapse: () => void;
  collapseLabel: string;
  expandLabel: string;
}

function SidebarBrandTitle({
  displayVersion,
  showEnvBadgeAfterVersion,
}: {
  displayVersion: string;
  showEnvBadgeAfterVersion: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <img
        src={sidebarLogoSvg}
        alt="SClaw"
        width={85}
        height={28}
        className="h-7 w-auto max-w-full shrink-0 object-contain object-left"
      />
      <span className={cn('shrink-0', sidebarBrandVersionClass)}>{displayVersion}</span>
      {showEnvBadgeAfterVersion ? (
        <span className="no-drag shrink-0">
          <ChromeEnvBadge />
        </span>
      ) : null}
    </div>
  );
}

export function SidebarBrandHeader({
  layoutVariant,
  onCollapse,
  collapseLabel,
  expandLabel,
}: SidebarBrandHeaderProps) {
  const isMac = window.electron?.platform === 'darwin';
  const isProvincial = layoutVariant === 'provincial';
  const showMacProvincialChromeRow = isMac && isProvincial;
  const showEnvBadgeAfterVersion = !isMac && Boolean(getCurrentEnvConfig().displaySuffix);
  const displayVersion = formatAppDisplayVersion(packageJson.version ?? '');

  const toggle = (
    <SidebarHeaderToggle
      isCollapsed={false}
      onToggle={onCollapse}
      collapseLabel={collapseLabel}
      expandLabel={expandLabel}
    />
  );

  if (showMacProvincialChromeRow) {
    return (
      <>
        <div
          className={cn(
            'drag-region flex min-h-[var(--sto-chrome-h)] shrink-0 items-start justify-between gap-2 px-3 pt-[var(--sto-chrome-toggle-inset-top)]',
            'pl-20',
          )}
        >
          <div className="no-drag flex min-w-0 flex-1 items-center">
            <ChromeEnvBadge />
          </div>
          {toggle}
        </div>
        <div className={cn('mt-1.5 flex shrink-0 items-center pb-2.5', SIDEBAR_BRAND_OUTER_X)}>
          <div className={cn('min-w-0', SIDEBAR_BRAND_INNER_X)}>
            <SidebarBrandTitle displayVersion={displayVersion} showEnvBadgeAfterVersion={false} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 pb-3',
        SIDEBAR_BRAND_OUTER_X,
        isProvincial ? 'pt-[var(--sto-chrome-toggle-inset-top)]' : 'border-b border-[var(--sto-sidebar-border)] pt-3',
      )}
    >
      <div className={cn('flex min-w-0 flex-1 items-center', SIDEBAR_BRAND_INNER_X)}>
        <SidebarBrandTitle
          displayVersion={displayVersion}
          showEnvBadgeAfterVersion={showEnvBadgeAfterVersion}
        />
      </div>
      {toggle}
    </div>
  );
}
