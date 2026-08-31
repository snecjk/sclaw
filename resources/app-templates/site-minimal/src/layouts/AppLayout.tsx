import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from 'antd';
import {
  DEFAULT_PATH,
  findSideNavByPath,
  pathFromLocation,
  SIDE_NAV,
  toRoutePath,
} from './nav-config';
import { AppHeader } from './AppHeader';
import { AppSider } from './AppSider';
import { PageContainer } from './PageContainer';
import { OpenTabs } from './OpenTabs';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = pathFromLocation(location.pathname) || DEFAULT_PATH;
  const selectedItem = findSideNavByPath(path);

  return (
    <Layout className="app-shell">
      <AppHeader />
      <OpenTabs
        activeItem={selectedItem}
        items={SIDE_NAV}
        onNavigate={(next) => navigate(toRoutePath(next))}
      />

      <Layout>
        <AppSider
          items={SIDE_NAV}
          selectedKey={selectedItem.key}
          onNavigate={(next) => navigate(toRoutePath(next))}
        />
        <PageContainer><Outlet /></PageContainer>
      </Layout>
    </Layout>
  );
}
