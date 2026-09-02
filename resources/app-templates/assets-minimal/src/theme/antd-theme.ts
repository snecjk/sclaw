import type { ThemeConfig } from 'antd';
import { STO_THEME_TOKENS } from './tokens';

export const stoAntdTheme: ThemeConfig = {
  token: {
    colorPrimary: STO_THEME_TOKENS.colorBrand,
    colorSuccess: STO_THEME_TOKENS.colorSuccess,
    colorInfo: STO_THEME_TOKENS.colorInfo,
    colorWarning: STO_THEME_TOKENS.colorWarning,
    colorError: STO_THEME_TOKENS.colorError,
    colorText: STO_THEME_TOKENS.colorText,
    colorTextHeading: STO_THEME_TOKENS.colorTextHeading,
    colorTextSecondary: STO_THEME_TOKENS.colorTextSecondary,
    colorTextDisabled: STO_THEME_TOKENS.colorTextDisabled,
    colorBgLayout: STO_THEME_TOKENS.colorBgLayout,
    colorBgContainer: STO_THEME_TOKENS.colorBgContainer,
    colorBorder: STO_THEME_TOKENS.colorBorder,
    colorBorderSecondary: STO_THEME_TOKENS.colorBorderSecondary,
    fontSize: STO_THEME_TOKENS.fontSize,
    borderRadius: STO_THEME_TOKENS.borderRadius,
    controlHeight: STO_THEME_TOKENS.controlHeight,
  },
  components: {
    Button: {
      colorPrimary: STO_THEME_TOKENS.colorPrimaryAction,
      colorPrimaryHover: STO_THEME_TOKENS.colorPrimaryHover,
      colorPrimaryActive: STO_THEME_TOKENS.colorPrimaryActive,
    },
  },
};
