import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

const PAGE_META: Record<string, { title: string; description?: string }> = {
  orders: {
    title: '业务列表',
    description: '在此接入查询条件 + 表格 + 分页等业务能力。',
  },
  reports: {
    title: '数据报表',
    description: '可接入图表组件展示经营指标。',
  },
  profile: {
    title: '个人中心',
    description: '展示当前登录用户资料与权限信息。',
  },
  settings: {
    title: '偏好设置',
    description: '主题、通知、默认筛选等本地偏好。',
  },
};

function PlaceholderRoute({ pageKey }: { pageKey: string }) {
  const meta = PAGE_META[pageKey];
  if (!meta) {
    return (
      <PlaceholderPage
        title="页面不存在"
        description={`未找到路径「${pageKey}」，请从左侧导航重新选择。`}
      />
    );
  }
  return <PlaceholderPage title={meta.title} description={meta.description} />;
}

function NotFoundPage() {
  return (
    <PlaceholderPage
      title="页面不存在"
      description="未找到该路径，请从左侧导航重新选择。"
    />
  );
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <HashRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage />} />
              <Route path="demo" element={<DemoPage />} />
              <Route path="orders" element={<PlaceholderRoute pageKey="orders" />} />
              <Route path="reports" element={<PlaceholderRoute pageKey="reports" />} />
              <Route path="profile" element={<PlaceholderRoute pageKey="profile" />} />
              <Route path="settings" element={<PlaceholderRoute pageKey="settings" />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
