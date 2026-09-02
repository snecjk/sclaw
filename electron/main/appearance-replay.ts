import { BrowserWindow, type WebContents } from 'electron';
import type { AppSettings } from '../utils/store';

const STO_APPEARANCE_STATE_EVENT = 'sto:appearance-state';

export type StoAppearanceState = {
  preference: AppSettings['theme'];
  appearance: 'light' | 'dark';
};

let currentAppearanceState: StoAppearanceState | null = null;
const lastPublishedStateByContents = new WeakMap<WebContents, string>();
const appearanceReplayByContents = new WeakMap<WebContents, () => void>();

function publishAppearanceState(contents: WebContents, state: StoAppearanceState): void {
  const stateKey = `${state.preference}:${state.appearance}`;
  if (lastPublishedStateByContents.get(contents) === stateKey) return;
  contents.send(STO_APPEARANCE_STATE_EVENT, state);
  lastPublishedStateByContents.set(contents, stateKey);
}

export function attachAppearanceReplay(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const { webContents } = window;
  if (webContents.isDestroyed() || appearanceReplayByContents.has(webContents)) return;

  const replay = () => {
    if (window.isDestroyed() || webContents.isDestroyed() || !currentAppearanceState) return;
    lastPublishedStateByContents.delete(webContents);
    publishAppearanceState(webContents, currentAppearanceState);
  };
  const cleanup = () => {
    webContents.removeListener('did-finish-load', replay);
    appearanceReplayByContents.delete(webContents);
    lastPublishedStateByContents.delete(webContents);
  };

  webContents.on('did-finish-load', replay);
  webContents.once('destroyed', cleanup);
  appearanceReplayByContents.set(webContents, replay);
}

export function broadcastAppearanceState(state: StoAppearanceState): void {
  currentAppearanceState = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    attachAppearanceReplay(window);
    const { webContents } = window;
    if (webContents.isDestroyed()) continue;
    publishAppearanceState(webContents, state);
  }
}
