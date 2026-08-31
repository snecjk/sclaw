import type { SideNavItem } from './nav-config';

interface OpenTabsProps {
  activeItem: SideNavItem;
  items: readonly SideNavItem[];
  onNavigate: (path: string) => void;
}

export function OpenTabs({ activeItem, items, onNavigate }: OpenTabsProps) {
  const tabs = activeItem.path === 'home' ? [items[0]!] : [items[0]!, activeItem];

  return (
    <nav className="sto-opentabs" aria-label="已打开页面">
      <div className="sto-opentabs-list">
        {tabs.map((item) => {
          const isHome = item.path === 'home';
          const isActive = item.key === activeItem.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`sto-opentab${isHome ? ' is-home' : ''}${isActive ? ' is-active' : ''}`}
              onClick={() => onNavigate(item.path)}
            >
              <span className="sto-opentab-bg" aria-hidden="true">
                <svg viewBox={isHome ? '0 0 52 24' : '0 0 125 24'} preserveAspectRatio="none">
                  <path fill="currentColor" d={isHome
                    ? 'M4,0L44,0C46.209141,0,48,1.7908607,48,4L48,20C48,22.209139,49.790859,24,52,24L0,24L0,4.0000005C0,1.7908607,1.7908607,0,4,0'
                    : 'M4,0L116,0C118.20914,0,120,1.7908607,120,4L120,20C120,22.209139,121.79086,24,124,24L125,24L0,24L0,4.0000005C0,1.7908607,1.7908607,0,4,0'} />
                </svg>
              </span>
              <span className="sto-opentab-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
