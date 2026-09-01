import { useEffect, useState } from 'react';
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
import { closeOpenTab, ensureOpenTab } from './open-tab-state';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = pathFromLocation(location.pathname) || DEFAULT_PATH;
  const selectedItem = findSideNavByPath(path);
  const [openPaths, setOpenPaths] = useState<string[]>([DEFAULT_PATH]);

  useEffect(() => {
    setOpenPaths((previous) => ensureOpenTab(previous, selectedItem.path));
  }, [selectedItem.path]);

  const navigateTo = (next: string) => {
    setOpenPaths((previous) => ensureOpenTab(previous, next));
    navigate(toRoutePath(next));
  };

  const closeTab = (closePath: string) => {
    const result = closeOpenTab(openPaths, closePath, selectedItem.path);
    setOpenPaths(result.openPaths);
    if (result.nextPath !== selectedItem.path) navigate(toRoutePath(result.nextPath));
  };

  return (
    <Layout className="app-shell">
      <AppHeader />
      <OpenTabs
        activeItem={selectedItem}
        items={SIDE_NAV}
        openPaths={openPaths}
        onNavigate={navigateTo}
        onClose={closeTab}
      />

      <Layout>
        <AppSider
          items={SIDE_NAV}
          selectedKey={selectedItem.key}
          onNavigate={navigateTo}
        />
        <PageContainer><Outlet /></PageContainer>
      </Layout>
    </Layout>
  );
}
