import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { stoAntdTheme } from './theme/antd-theme';

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
    <ConfigProvider locale={zhCN} theme={stoAntdTheme}>
      <AntdApp>
        <HashRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage />} />
              <Route path="example" element={<DemoPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
