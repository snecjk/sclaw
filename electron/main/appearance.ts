import { BrowserWindow, nativeTheme } from 'electron';
import { getSetting, type AppSettings } from '../utils/store';
import { getFloatIconWindow } from './float-icon-window';
import { getSpriteWindow } from './sprite-window';
import {
  attachAppearanceReplay,
  broadcastAppearanceState,
  type StoAppearanceState,
} from './appearance-replay';

export { attachAppearanceReplay };

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

export function normalizeThemePreference(value: unknown): AppSettings['theme'] {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

function resolveAppearanceState(theme: AppSettings['theme']): StoAppearanceState {
  const appearance = theme === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : theme;
  return { preference: theme, appearance };
}

function updateOpaqueWindowBackgrounds(appearance: StoAppearanceState['appearance']): void {
  const background = resolveWindowBackgroundColor(appearance === 'dark');
  const transparentWindows = new Set([getSpriteWindow(), getFloatIconWindow()]);

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !transparentWindows.has(window)) {
      window.setBackgroundColor(background);
    }
  }
}

export function applyNativeAppearancePreference(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme;
  const state = resolveAppearanceState(theme);
  updateOpaqueWindowBackgrounds(state.appearance);
  broadcastAppearanceState(state);
}

export async function syncNativeAppearanceFromStore(): Promise<void> {
  applyNativeAppearancePreference(normalizeThemePreference(await getSetting('theme')));
}

export function observeNativeAppearanceUpdates(): () => void {
  if (nativeAppearanceObserverCleanup) {
    return nativeAppearanceObserverCleanup;
  }

  const update = () => {
    const preference = normalizeThemePreference(nativeTheme.themeSource);
    const state = resolveAppearanceState(preference);
    updateOpaqueWindowBackgrounds(state.appearance);
    broadcastAppearanceState(state);
  };
  const cleanup = () => {
    nativeTheme.removeListener('updated', update);
    nativeAppearanceObserverCleanup = null;
  };

  nativeTheme.on('updated', update);
  nativeAppearanceObserverCleanup = cleanup;
  return cleanup;
}
