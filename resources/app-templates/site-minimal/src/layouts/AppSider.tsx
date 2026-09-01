import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import type { SideNavItem } from './nav-config';

const { Sider } = Layout;

interface AppSiderProps {
  items: readonly SideNavItem[];
  selectedKey: string;
  onNavigate: (path: string) => void;
}

export function toAntdMenuItems(items: readonly SideNavItem[]): MenuProps['items'] {
  return items.map((item) => ({
    key: item.key,
    label: item.developerOnly ? `${item.label}（开发）` : item.label,
    ...(item.children ? { children: toAntdMenuItems(item.children) } : {}),
  }));
}

export function AppSider({ items, selectedKey, onNavigate }: AppSiderProps) {
  const menuItems = toAntdMenuItems(items);

  const findPage = (entries: readonly SideNavItem[], key: string): SideNavItem | undefined => {
    for (const entry of entries) {
      if (entry.key === key && !entry.children) return entry;
      if (entry.children) {
        const nested = findPage(entry.children, key);
        if (nested) return nested;
      }
    }
    return undefined;
  };

  return (
    <Sider width={180} theme="light" className="app-sider">
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => {
          const item = findPage(items, key);
          if (item?.path) onNavigate(item.path);
        }}
        className="app-side-menu"
      />
    </Sider>
  );
}
