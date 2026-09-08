import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Layout, Result, Spin } from 'antd';
import {
  createAuthorizedMenuReadyState,
} from './authorized-menu-state';
import {
  pathFromLocation,
  toRoutePath,
} from './nav-config';
import { AppHeader } from './AppHeader';
import { AppSider } from './AppSider';
import { PageContainer } from './PageContainer';
import { OpenTabs } from './OpenTabs';
import { closeOpenTab, ensureOpenTab } from './open-tab-state';
import { EmptyState } from '../components/EmptyState';
import { useAuthorizedMenu } from './use-authorized-menu';

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const menu = useAuthorizedMenu();
  const path = pathFromLocation(location.pathname);
  const ready = useMemo(() => (
    menu.status === 'ready'
      ? createAuthorizedMenuReadyState(menu.items, path)
      : null
  ), [menu.items, menu.status, path]);
  const selectedItem = ready?.selectedItem;
  const pinnedPath = ready?.pages[0]?.path;
  const [openPaths, setOpenPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || !selectedItem || !pinnedPath) return;
    if (ready.redirectPath) {
      navigate(toRoutePath(ready.redirectPath), { replace: true });
      return;
    }
    const allowedPaths = new Set(ready.pages.map((item) => item.path));
    setOpenPaths((previous) => ensureOpenTab(
      previous.filter((item) => allowedPaths.has(item)),
      selectedItem.path,
      pinnedPath,
    ));
  }, [navigate, pinnedPath, ready, selectedItem]);

  if (menu.status === 'loading') {
    return (
      <Layout className="app-shell">
        <AppHeader />
        <main className="app-menu-state">
          <Spin size="large" tip="正在加载应用菜单..." />
        </main>
      </Layout>
    );
  }

  if (menu.status === 'error') {
    return (
      <Layout className="app-shell">
        <AppHeader />
        <main className="app-menu-state">
          <Result
            status="error"
            title="菜单加载失败"
            subTitle={menu.error}
            extra={<Button type="primary" onClick={menu.reload}>重新加载</Button>}
          />
        </main>
      </Layout>
    );
  }

  if (menu.status === 'empty') {
    return (
      <Layout className="app-shell">
        <AppHeader />
        <main className="app-menu-state">
          <EmptyState
            title="暂无可访问菜单"
            description="当前账号没有此应用的菜单访问权限。"
          />
        </main>
      </Layout>
    );
  }

  if (!ready || !selectedItem || !pinnedPath || ready.redirectPath) {
    return (
      <Layout className="app-shell">
        <AppHeader />
        <main className="app-menu-state">
          <Spin size="large" tip="正在进入授权页面..." />
        </main>
      </Layout>
    );
  }

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
        items={ready.pages}
        openPaths={openPaths}
        pinnedPath={pinnedPath}
        onNavigate={navigateTo}
        onClose={closeTab}
      />

      <Layout>
        <AppSider
          items={ready.items}
          selectedKey={selectedItem.key}
          onNavigate={navigateTo}
        />
        <PageContainer><Outlet /></PageContainer>
      </Layout>
    </Layout>
  );
}
