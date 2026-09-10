import type { ThemeConfig } from 'antd';

export const stoAssetsTheme: ThemeConfig = {
  token: {
    colorPrimary: '#ff6700',
    colorPrimaryHover: '#ff852e',
    colorPrimaryActive: '#d24d00',
    colorSuccess: '#52c41a',
    colorInfo: '#1677ff',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorText: '#1d2129',
    colorTextHeading: '#1d2129',
    colorTextSecondary: '#4e5969',
    colorTextDisabled: '#c9cdd4',
    colorBgLayout: '#f0f2f5',
    colorBgContainer: '#ffffff',
    colorBorder: '#c9cdd4',
    colorBorderSecondary: '#e5e6eb',
    fontSize: 14,
    borderRadius: 6,
    controlHeight: 28,
  },
  components: {
    Table: {
      headerBg: '#f5f5f5',
      headerColor: '#1d2129',
      borderColor: '#e5e6eb',
      rowHoverBg: '#fff7e6',
    },
  },
};
