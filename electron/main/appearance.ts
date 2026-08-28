import { BrowserWindow, nativeTheme } from 'electron';
import { getSetting, type AppSettings } from '../utils/store';
import { getFloatIconWindow } from './float-icon-window';
import { getSpriteWindow } from './sprite-window';

export const LIGHT_WINDOW_BACKGROUND = '#ededed';
export const DARK_WINDOW_BACKGROUND = '#0d0d0d';
const DEFAULT_THEME_PREFERENCE: AppSettings['theme'] = 'light';

let nativeAppearanceObserverCleanup: (() => void) | null = null;

export function resolveWindowBackgroundColor(isDark: boolean): string {
  return isDark ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

export function isThemePreference(value: unknown): value is AppSettings['theme'] {
  return value === 'light' || value === 'dark' || value === 'system';
}

function updateOpaqueWindowBackgrounds(): void {
  const background = resolveWindowBackgroundColor(nativeTheme.shouldUseDarkColors);
  const transparentWindows = new Set([getSpriteWindow(), getFloatIconWindow()]);

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !transparentWindows.has(window)) {
      window.setBackgroundColor(background);
    }
  }
}

export function applyNativeAppearancePreference(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme;
  updateOpaqueWindowBackgrounds();
}

export async function syncNativeAppearanceFromStore(): Promise<void> {
  const theme = await getSetting('theme');
  applyNativeAppearancePreference(isThemePreference(theme) ? theme : DEFAULT_THEME_PREFERENCE);
}

export function observeNativeAppearanceUpdates(): () => void {
  if (nativeAppearanceObserverCleanup) {
    return nativeAppearanceObserverCleanup;
  }

  const update = () => {
    updateOpaqueWindowBackgrounds();
  };
  const cleanup = () => {
    nativeTheme.removeListener('updated', update);
    nativeAppearanceObserverCleanup = null;
  };

  nativeTheme.on('updated', update);
  nativeAppearanceObserverCleanup = cleanup;
  return cleanup;
}
