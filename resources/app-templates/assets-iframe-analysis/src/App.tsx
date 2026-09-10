import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AnalysisPage } from './pages/AnalysisPage';

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}>
      <AntdApp>
        <AnalysisPage />
      </AntdApp>
    </ConfigProvider>
  );
}
