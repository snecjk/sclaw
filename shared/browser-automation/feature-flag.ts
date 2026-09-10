/** Feature flag for Browser Automation Platform. Disabled in production until explicitly enabled. */

export type BrowserAutomationLevel = 'off' | 'dom' | 'ax';

const SETTINGS_LEVEL_KEY = '__stoBaLevel';

type LevelHost = typeof globalThis & { [SETTINGS_LEVEL_KEY]?: BrowserAutomationLevel };

function readInjectedLevel(): BrowserAutomationLevel | undefined {
  const injected = (globalThis as LevelHost)[SETTINGS_LEVEL_KEY];
  if (injected === 'off' || injected === 'dom' || injected === 'ax') return injected;
  return undefined;
}

function parseLevelToken(raw: string): BrowserAutomationLevel | null {
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on' || value === 'dom') return 'dom';
  if (value === 'ax') return 'ax';
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return 'off';
  return null;
}

/**
 * 分级开关（计划 §四 A3 / H2）：env 覆盖 > 设置页注入 > 环境默认。
 * 本文件同时被 renderer import，不能同步读 electron-store；主进程/设置页通过
 * `setBrowserAutomationSettingsLevel` 写入 globalThis。
 */
export function setBrowserAutomationSettingsLevel(level: BrowserAutomationLevel | null): void {
  const host = globalThis as LevelHost;
  if (level === null) delete host[SETTINGS_LEVEL_KEY];
  else host[SETTINGS_LEVEL_KEY] = level;
}

export function getBrowserAutomationLevel(): BrowserAutomationLevel {
  const raw = (process.env.STOCLAW_BROWSER_AUTOMATION ?? process.env.VITE_STOCLAW_BROWSER_AUTOMATION ?? '').trim();
  if (raw) {
    const parsed = parseLevelToken(raw);
    if (parsed) return parsed;
  }
  const injected = readInjectedLevel();
  if (injected) return injected;
  return process.env.NODE_ENV !== 'production' ? 'ax' : 'dom';
}

export function isBrowserAutomationEnabled(): boolean {
  return getBrowserAutomationLevel() !== 'off';
}

export function isBrowserAutomationAxEnabled(): boolean {
  return getBrowserAutomationLevel() === 'ax';
}

export function parseBrowserAutomationLevel(value: unknown): BrowserAutomationLevel | null {
  if (typeof value !== 'string') return null;
  if (value === 'off' || value === 'dom' || value === 'ax') return value;
  return parseLevelToken(value);
}
