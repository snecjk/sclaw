import { Layout, Menu } from 'antd';
import type { SideNavItem } from './nav-config';

const { Sider } = Layout;

interface AppSiderProps {
  items: readonly SideNavItem[];
  selectedKey: string;
  onNavigate: (path: string) => void;
}

export function AppSider({ items, selectedKey, onNavigate }: AppSiderProps) {
  return (
    <Sider width={220} theme="light" className="app-sider">
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={items.map((item) => ({
          key: item.key,
          label: item.developerOnly ? `${item.label}（开发）` : item.label,
        }))}
        onClick={({ key }) => {
          const item = items.find((entry) => entry.key === key);
          if (item) onNavigate(item.path);
        }}
        className="app-side-menu"
      />
    </Sider>
  );
}
