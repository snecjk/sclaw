import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  DEFAULT_PATH,
  findNavByPath,
  pathFromLocation,
  toRoutePath,
  TOP_NAV,
} from './nav-config';
import { getUserDisplayFromToken } from '../lib/auth-token';
import { logout } from '../lib/sso';

const { Header, Sider, Content } = Layout;

export function AppLayout() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const path = pathFromLocation(location.pathname) || DEFAULT_PATH;
  const { topKey, sideKey, sideItems } = findNavByPath(path);
  const user = getUserDisplayFromToken();

  const go = (next: string) => {
    navigate(toRoutePath(next));
  };

  const onTopClick: MenuProps['onClick'] = ({ key }) => {
    const top = TOP_NAV.find((item) => item.key === key);
    const first = top?.children[0];
    if (first) go(first.path);
  };

  const onSideClick: MenuProps['onClick'] = ({ key }) => {
    const item = sideItems.find((entry) => entry.key === key);
    if (item) go(item.path);
  };

  const userMenu: MenuProps['items'] = [
    {
      key: 'profile',
      label: '个人中心',
      onClick: () => go('profile'),
    },
    {
      key: 'settings',
      label: '偏好设置',
      onClick: () => go('settings'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      label: '退出登录',
      onClick: () => logout(),
    },
  ];

  return (
    <Layout className="app-shell">
      <Header className="app-header" style={{ background: token.colorBgContainer }}>
        <div className="app-header-brand">
          <div className="app-logo" aria-hidden>
            S
          </div>
          <div className="app-brand-text">
            <Typography.Text strong className="app-brand-title">
              __APP_TITLE__
            </Typography.Text>
            <Typography.Text type="secondary" className="app-brand-sub">
              企业应用工作台
            </Typography.Text>
          </div>
        </div>

        <Menu
          mode="horizontal"
          selectedKeys={[topKey]}
          items={TOP_NAV.map((item) => ({ key: item.key, label: item.label }))}
          onClick={onTopClick}
          className="app-top-menu"
        />

        <Dropdown menu={{ items: userMenu }} placement="bottomRight">
          <button type="button" className="app-user-trigger">
            <Avatar size={32} style={{ backgroundColor: token.colorPrimary }}>
              {user.name.slice(0, 1)}
            </Avatar>
            <span className="app-user-meta">
              <span className="app-user-name">{user.name}</span>
              {user.code ? (
                <span className="app-user-code">{user.code}</span>
              ) : null}
            </span>
          </button>
        </Dropdown>
      </Header>

      <Layout>
        <Sider
          width={220}
          theme="light"
          className="app-sider"
          style={{ background: token.colorBgContainer }}
        >
          <Menu
            mode="inline"
            selectedKeys={[sideKey]}
            items={sideItems.map((item) => ({ key: item.key, label: item.label }))}
            onClick={onSideClick}
            className="app-side-menu"
          />
        </Sider>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
