import { Avatar, Dropdown, Layout, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { getSsoAuth } from '@sto/sclaw-plugin-sso-auth';

const { Header } = Layout;

export function AppHeader() {
  const currentUser = getSsoAuth().getUser();
  const name = currentUser?.userName || '已登录用户';
  const code = currentUser?.userCode;
  const items: MenuProps['items'] = [
    {
      key: 'logout',
      label: '退出登录',
      onClick: () => void getSsoAuth().logout(),
    },
  ];

  return (
    <Header className="app-header">
      <div className="app-header-brand">
        <div className="app-logo" aria-hidden>STO</div>
        <div className="app-brand-text">
          <Typography.Text strong className="app-brand-title">__APP_TITLE__</Typography.Text>
          <Typography.Text type="secondary" className="app-brand-sub">企业应用</Typography.Text>
        </div>
      </div>

      <Dropdown menu={{ items }} placement="bottomRight">
        <button type="button" className="app-user-trigger" aria-label="打开用户菜单">
          <Avatar className="app-user-avatar">{name.slice(0, 1)}</Avatar>
          <span className="app-user-meta">
            <span className="app-user-name">{name}</span>
            {code ? <span className="app-user-code">{code}</span> : null}
          </span>
        </button>
      </Dropdown>
    </Header>
  );
}
