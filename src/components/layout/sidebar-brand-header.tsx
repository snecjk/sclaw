/**
 * SidebarBrandHeader — 侧栏顶品牌区（含字 logo + 版本 + 折叠钮）。
 *
 * 省区 Mac：chrome 行（DEV 在红绿灯后 + 折叠）+ 品牌行；
 * 省区 Win / 完整 layout：单行（Win 在版本号后展示 DEV）。
 */
import sidebarLogoSvg from '@/assets/sidebar-logo.svg';
import sidebarLogoDarkSvg from '@/assets/sidebar-logo-dark.svg';
import { cn } from '@/lib/utils';
import { sidebarBrandLogoClass, sidebarBrandVersionClass } from '@/lib/surfaces';
import { useThemeAppearance } from '@/components/theme/appearance-context';
import { formatAppDisplayVersion } from '@/lib/format-app-display-version';
import { ChromeEnvBadge } from '@/components/layout/chrome-env-badge';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import type { SidebarLayoutVariant } from '@/lib/sidebar-layout';
import packageJson from '../../../package.json';
import { SidebarTooltip } from '@/components/layout/sidebar-tooltip';

const SCLAW_OFFICIAL_WEBSITE = 'https://sclaw.sto.cn/';

/** 与 Sidebar nav 容器一致（展开态 `px-2`） */
const SIDEBAR_BRAND_OUTER_X = 'px-2';
/** 品牌标题左缘比 nav 图标左移 2px（pl-2 + pr-[10px]） */
const SIDEBAR_BRAND_INNER_X = 'pl-2 pr-[10px]';

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
  const appearance = useThemeAppearance();
  const openOfficialWebsite = () => {
    if (window.electron?.openExternal) {
      void window.electron.openExternal(SCLAW_OFFICIAL_WEBSITE);
      return;
    }

    window.open(SCLAW_OFFICIAL_WEBSITE, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <SidebarTooltip label="打开 SClaw 官网" sideOffset={8}>
        <button
          type="button"
          aria-label="打开 SClaw 官网"
          onClick={openOfficialWebsite}
          className="no-drag shrink-0 rounded-md p-0 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--sto-focus-ring)] focus-visible:ring-offset-1"
        >
          <img
            src={appearance === 'dark' ? sidebarLogoDarkSvg : sidebarLogoSvg}
            alt="SClaw"
            width={85}
            height={28}
            className={sidebarBrandLogoClass}
          />
        </button>
      </SidebarTooltip>
      <SidebarTooltip label={displayVersion} sideOffset={8}>
        <span className={cn('min-w-0 truncate', sidebarBrandVersionClass)}>
          {displayVersion}
        </span>
      </SidebarTooltip>
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
      className="mr-1"
    />
  );

  if (showMacProvincialChromeRow) {
    return (
      <>
        <div
          className={cn(
            'drag-region flex min-h-[var(--sto-sidebar-chrome-h)] shrink-0 items-start justify-between gap-2 px-2 pt-[var(--sto-sidebar-chrome-toggle-inset-top)]',
            'pl-20',
          )}
        >
          <div className="no-drag flex min-w-0 flex-1 items-center">
            <ChromeEnvBadge />
          </div>
          {toggle}
        </div>
        <div className={cn('mt-1.5 flex shrink-0 items-center pb-1.5', SIDEBAR_BRAND_OUTER_X)}>
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
        'flex shrink-0 items-center justify-between gap-2 pb-2',
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
