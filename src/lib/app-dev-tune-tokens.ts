/**
 * 设计 token 契约类型 + 默认降级项 + oklch/hex 互转（T06）。
 */

export type AppDevTuneTokenType = 'color' | 'font' | 'radius';

export interface AppDevTuneTokenDef {
  name: string;
  label: string;
  type: AppDevTuneTokenType;
  format?: 'oklch' | 'rem';
  group: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface AppDevDesignTokensContract {
  schemaVersion: number;
  source: string;
  tokens: AppDevTuneTokenDef[];
}

/** 旧模板无契约时的内置 6 项。 */
export const APP_DEV_DEFAULT_TUNE_TOKENS: AppDevTuneTokenDef[] = [
  { name: '--sto-color-bg-layout', label: '页面背景', type: 'color', format: 'oklch', group: '颜色' },
  { name: '--sto-color-primary', label: '主题色', type: 'color', format: 'oklch', group: '颜色' },
  { name: '--sto-color-text', label: '正文色', type: 'color', format: 'oklch', group: '颜色' },
  {
    name: '--sto-font-family',
    label: '正文字体',
    type: 'font',
    group: '字体',
    options: [
      '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      'Georgia, "Times New Roman", serif',
      'Menlo, Consolas, monospace',
    ],
  },
  { name: '--sto-radius-lg', label: '卡片圆角', type: 'radius', format: 'rem', group: '圆角', min: 0, max: 1 },
  { name: '--sto-color-border', label: '边框色', type: 'color', format: 'oklch', group: '颜色' },
];

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatOklch({ l, c, h }: OklchColor): string {
  return `oklch(${clamp(l, 0, 1).toFixed(3)} ${clamp(c, 0, 0.4).toFixed(3)} ${clamp(h, 0, 360).toFixed(1)})`;
}

export function parseOklch(input: string): OklchColor | null {
  const m = input.trim().match(/^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/i);
  if (!m) return null;
  return {
    l: clamp(Number(m[1]), 0, 1),
    c: clamp(Number(m[2]), 0, 0.4),
    h: clamp(Number(m[3]), 0, 360),
  };
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** 粗略 hex → oklch（足够给色板初值；精度非设计工具级）。 */
export function hexToOklch(hex: string): OklchColor | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = (max - min) * 0.25;
  let h = 0;
  if (max !== min) {
    if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
  }
  if (h < 0) h += 360;
  return { l: clamp(l, 0, 1), c: clamp(c, 0, 0.4), h: clamp(h, 0, 360) };
}

export function rgbToOklch(input: string): OklchColor | null {
  const trimmed = input.trim();
  const match = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const hex = `#${[match[1], match[2], match[3]]
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, '0'))
    .join('')}`;
  return hexToOklch(hex);
}

export function isTransparentCssColor(input: string | undefined): boolean {
  const value = (input ?? '').trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none') return true;
  return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)$/.test(value);
}

export function parseColorToOklch(input: string): OklchColor | null {
  const trimmed = input.trim();
  return parseOklch(trimmed) ?? hexToOklch(trimmed) ?? rgbToOklch(trimmed);
}

export function parseRem(input: string): number | null {
  const m = input.trim().match(/^([0-9.]+)rem$/i);
  if (m) return Number(m[1]);
  const px = input.trim().match(/^([0-9.]+)px$/i);
  if (px) return Number(px[1]) / 16;
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

export function formatRem(value: number): string {
  return `${clamp(value, 0, 2).toFixed(3).replace(/\.?0+$/, '')}rem`;
}

export function normalizeDesignTokensContract(raw: unknown): AppDevDesignTokensContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const tokens = (raw as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const normalized: AppDevTuneTokenDef[] = [];
  for (const item of tokens) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== 'string' || !rec.name.startsWith('--')) continue;
    if (typeof rec.label !== 'string') continue;
    if (rec.type !== 'color' && rec.type !== 'font' && rec.type !== 'radius') continue;
    normalized.push({
      name: rec.name,
      label: rec.label,
      type: rec.type,
      format: rec.format === 'oklch' || rec.format === 'rem' ? rec.format : undefined,
      group: typeof rec.group === 'string' ? rec.group : '其他',
      options: Array.isArray(rec.options)
        ? rec.options.filter((x): x is string => typeof x === 'string')
        : undefined,
      min: typeof rec.min === 'number' ? rec.min : undefined,
      max: typeof rec.max === 'number' ? rec.max : undefined,
    });
  }
  if (normalized.length === 0) return null;
  return {
    schemaVersion: typeof (raw as { schemaVersion?: unknown }).schemaVersion === 'number'
      ? (raw as { schemaVersion: number }).schemaVersion
      : 1,
    source: typeof (raw as { source?: unknown }).source === 'string'
      ? (raw as { source: string }).source
      : 'src/theme/theme.css',
    tokens: normalized,
  };
}
