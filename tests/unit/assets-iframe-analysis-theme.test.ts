import { describe, expect, it } from 'vitest';

import { stoAssetsTheme } from '../../resources/app-templates/assets-iframe-analysis/src/theme/antd-theme';

describe('assets iframe analysis theme', () => {
  it('uses the STO orange design tokens for Ant Design components', () => {
    expect(stoAssetsTheme.token).toMatchObject({
      colorPrimary: '#ff6700',
      colorBgLayout: '#f0f2f5',
      colorBorderSecondary: '#e5e6eb',
      borderRadius: 6,
      controlHeight: 28,
    });
    expect(stoAssetsTheme.components?.Table).toMatchObject({
      headerBg: '#f5f5f5',
      rowHoverBg: '#fff7e6',
    });
  });
});
