/**
 * JS 侧主题 token —— 值一律引用 theme.css CSS 变量。
 * 唯一事实来源是 `src/theme/theme.css`；禁止在此写独立 hex。
 */
export const STO_THEME_TOKENS = {
  colorBrand: 'var(--sto-color-brand)',
  colorPrimaryAction: 'var(--sto-color-primary-action)',
  colorPrimaryHover: 'var(--sto-color-primary-hover)',
  colorPrimaryActive: 'var(--sto-color-primary-active)',
  colorSuccess: 'var(--sto-color-success)',
  colorInfo: 'var(--sto-color-info)',
  colorWarning: 'var(--sto-color-warning)',
  colorError: 'var(--sto-color-error)',
  colorText: 'var(--sto-color-text)',
  colorTextHeading: 'var(--sto-color-text-heading)',
  colorTextSecondary: 'var(--sto-color-text-secondary)',
  colorTextDisabled: 'var(--sto-color-text-disabled)',
  colorBgLayout: 'var(--sto-color-bg-layout)',
  colorBgContainer: 'var(--sto-color-bg-container)',
  colorBorder: 'var(--sto-color-border)',
  colorBorderSecondary: 'var(--sto-color-border-secondary)',
  fontSize: 14,
  borderRadius: 6,
  controlHeight: 28,
} as const;
