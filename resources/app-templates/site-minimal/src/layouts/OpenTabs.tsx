import type { SideNavItem } from './nav-config';

interface OpenTabsProps {
  activeItem: SideNavItem;
  items: readonly SideNavItem[];
  openPaths: readonly string[];
  onNavigate: (path: string) => void;
  onClose: (path: string) => void;
}

export function OpenTabs({ activeItem, items, openPaths, onNavigate, onClose }: OpenTabsProps) {
  const tabs = openPaths
    .map((path) => items.find((item) => item.path === path))
    .filter((item): item is SideNavItem => Boolean(item));

  return (
    <nav className="sto-opentabs" aria-label="已打开页面">
      <div className="sto-opentabs-list">
        {tabs.map((item) => {
          const isHome = item.path === 'home';
          const isActive = item.key === activeItem.key;
          return (
            <div
              key={item.key}
              className={`sto-opentab${isHome ? ' is-home' : ''}${isActive ? ' is-active' : ''}`}
            >
              <span className="sto-opentab-bg" aria-hidden="true">
                <svg viewBox={isHome ? '0 0 52 24' : '0 0 125 24'} preserveAspectRatio="none">
                  <path fill="currentColor" d={isHome
                    ? 'M4,0L44,0C46.209141,0,48,1.7908607,48,4L48,20C48,22.209139,49.790859,24,52,24L0,24L0,4.0000005C0,1.7908607,1.7908607,0,4,0'
                    : 'M4,0L116,0C118.20914,0,120,1.7908607,120,4L120,20C120,22.209139,121.79086,24,124,24L125,24L0,24L0,4.0000005C0,1.7908607,1.7908607,0,4,0'} />
                </svg>
              </span>
              <button
                type="button"
                className="sto-opentab-trigger"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate(item.path)}
              >
                <span className="sto-opentab-label">{item.label}</span>
              </button>
              {!isHome ? (
                <button
                  type="button"
                  className="sto-opentab-close"
                  aria-label={`关闭${item.label}`}
                  onClick={() => onClose(item.path)}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
