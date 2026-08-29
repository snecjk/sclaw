import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { getSetting, type AppSettings } from '../utils/store';
import { getFloatIconWindow } from './float-icon-window';
import { getSpriteWindow } from './sprite-window';

const STO_APPEARANCE_STATE_EVENT = 'sto:appearance-state';

type StoAppearanceState = {
  preference: AppSettings['theme'];
  appearance: 'light' | 'dark';
};

export const LIGHT_WINDOW_BACKGROUND = '#ededed';
export const DARK_WINDOW_BACKGROUND = '#0d0d0d';
const DEFAULT_THEME_PREFERENCE: AppSettings['theme'] = 'light';

let nativeAppearanceObserverCleanup: (() => void) | null = null;
let currentAppearanceState: StoAppearanceState | null = null;
const lastPublishedStateByContents = new WeakMap<WebContents, string>();
const appearanceReplayByContents = new WeakMap<WebContents, () => void>();

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

function publishAppearanceState(contents: WebContents, state: StoAppearanceState): void {
  const stateKey = `${state.preference}:${state.appearance}`;
  if (lastPublishedStateByContents.get(contents) === stateKey) return;
  contents.send(STO_APPEARANCE_STATE_EVENT, state);
  lastPublishedStateByContents.set(contents, stateKey);
}

function attachAppearanceReplay(contents: WebContents): void {
  if (appearanceReplayByContents.has(contents)) return;

  const replay = () => {
    if (contents.isDestroyed() || !currentAppearanceState) return;
    lastPublishedStateByContents.delete(contents);
    publishAppearanceState(contents, currentAppearanceState);
  };
  const cleanup = () => {
    contents.removeListener('did-finish-load', replay);
    appearanceReplayByContents.delete(contents);
    lastPublishedStateByContents.delete(contents);
  };

  contents.on('did-finish-load', replay);
  contents.once('destroyed', cleanup);
  appearanceReplayByContents.set(contents, replay);
}

function broadcastAppearanceState(state: StoAppearanceState): void {
  currentAppearanceState = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const { webContents } = window;
    if (webContents.isDestroyed()) continue;
    attachAppearanceReplay(webContents);
    publishAppearanceState(webContents, state);
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
