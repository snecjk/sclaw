import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AnalysisPage } from './pages/AnalysisPage';
import { stoAssetsTheme } from './theme/antd-theme';

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={stoAssetsTheme}>
      <AntdApp>
        <AnalysisPage />
      </AntdApp>
    </ConfigProvider>
  );
}
