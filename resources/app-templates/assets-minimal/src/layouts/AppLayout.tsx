import { useEffect, useMemo, useState } from 'react';
import { Layout } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { AppSider } from './AppSider';
import { OpenTabs } from './OpenTabs';
import { PageContainer } from './PageContainer';
import {
  findSideNavByPath,
  flattenPageNavItems,
  pathFromLocation,
  SIDE_NAV,
  toRoutePath,
} from './nav-config';
import { closeOpenTab, ensureOpenTab } from './open-tab-state';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const pages = useMemo(() => flattenPageNavItems(SIDE_NAV), []);
  const pinnedPath = pages[0]!.path;
  const path = pathFromLocation(location.pathname);
  const matchedItem = findSideNavByPath(SIDE_NAV, path);
  const selectedItem = matchedItem ?? pages[0]!;
  const [openPaths, setOpenPaths] = useState<string[]>([pinnedPath]);

  useEffect(() => {
    if (!matchedItem) {
      navigate(toRoutePath(pinnedPath), { replace: true });
      return;
    }
    setOpenPaths((previous) => ensureOpenTab(previous, matchedItem.path, pinnedPath));
  }, [matchedItem, navigate, pinnedPath]);

  const navigateTo = (next: string) => {
    setOpenPaths((previous) => ensureOpenTab(previous, next, pinnedPath));
    navigate(toRoutePath(next));
  };

  const closeTab = (closePath: string) => {
    const result = closeOpenTab(openPaths, closePath, selectedItem.path, pinnedPath);
    setOpenPaths(result.openPaths);
    if (result.nextPath !== selectedItem.path) navigate(toRoutePath(result.nextPath));
  };

  return (
    <Layout className="app-shell">
      <AppHeader />
      <OpenTabs
        activeItem={selectedItem}
        items={pages}
        openPaths={openPaths}
        pinnedPath={pinnedPath}
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
