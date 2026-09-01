/**
 * Sprite Window Management
 * Creates and manages the desktop sprite (桌面小精灵) floating window
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { isQuitting } from './app-state';
import { attachAppearanceReplay } from './appearance-replay';

let spriteWindow: BrowserWindow | null = null;

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let spriteStateStore: any = null;

interface SpriteWindowState {
  x?: number;
  y?: number;
  visible?: boolean;
}

async function getStore() {
  if (!spriteStateStore) {
    const Store = (await import('electron-store')).default;
    spriteStateStore = new Store<{ spriteState: SpriteWindowState }>({
      name: 'sprite-window-state',
      defaults: {
        spriteState: { visible: false },
      },
    });
  }
  return spriteStateStore;
}

/**
 * Get saved sprite position with display bounds validation
 */
async function getSpritePosition(): Promise<{ x: number; y: number }> {
  const store = await getStore();
  const state: SpriteWindowState = store.get('spriteState');

  if (state.x !== undefined && state.y !== undefined) {
    // Validate that the sprite is visible on a screen
    const displays = screen.getAllDisplays();
    const isVisible = displays.some((display) => {
      const { x, y, width, height } = display.bounds;
      return (
        state.x! >= x &&
        state.x! < x + width &&
        state.y! >= y &&
        state.y! < y + height
      );
    });

    if (isVisible) {
      return { x: state.x, y: state.y };
    }
  }

  // Default: bottom-right of primary display
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;
  return {
    x: workX + width - 380 - 40,
    y: workY + height - 520 - 40,
  };
}

/**
 * Save sprite state (position + visibility)
 */
async function saveSpriteState(win: BrowserWindow, visible?: boolean): Promise<void> {
  const store = await getStore();
  const bounds = win.getBounds();
  const current: SpriteWindowState = store.get('spriteState');
  store.set('spriteState', {
    x: bounds.x,
    y: bounds.y,
    visible: visible !== undefined ? visible : current.visible,
  });
}

/**
 * Create the sprite floating window
 */
export function createSpriteWindow(): BrowserWindow {
  if (spriteWindow && !spriteWindow.isDestroyed()) {
    return spriteWindow;
  }

  const win = new BrowserWindow({
    width: 380,
    height: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  attachAppearanceReplay(win);

  // Set floating level for less aggressive always-on-top
  win.setAlwaysOnTop(true, 'floating');

  // Restore saved position
  void getSpritePosition().then((pos) => {
    if (!win.isDestroyed()) {
      win.setPosition(pos.x, pos.y);
    }
  });

  // Load the sprite route
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/sprite`);
  } else {
    // In production, loadFile + hash
    void win.loadFile(join(__dirname, '../../dist/index.html'), {
      hash: '/sprite',
    });
  }

  // Intercept close -> hide (unless app is quitting)
  win.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (spriteWindow === win) {
      spriteWindow = null;
    }
  });

  // Save position on move
  win.on('move', () => {
    void saveSpriteState(win);
  });

  // Save visible=false when user closes the sprite window
  win.on('hide', () => {
    void saveSpriteState(win, false);
  });

  spriteWindow = win;
  return win;
}

/**
 * Reset sprite visibility to false on app quit.
 * Ensures the sprite does not auto-show on next launch.
 */
export async function resetSpriteVisibilityOnQuit(): Promise<void> {
  const store = await getStore();
  const current: SpriteWindowState = store.get('spriteState');
  store.set('spriteState', { ...current, visible: false });
}

/**
 * Get the sprite window instance (or null)
 */
export function getSpriteWindow(): BrowserWindow | null {
  if (spriteWindow && !spriteWindow.isDestroyed()) {
    return spriteWindow;
  }
  return null;
}

/**
 * Show the sprite window
 */
export function showSprite(): void {
  const win = getSpriteWindow();
  if (win) {
    win.show();
    void saveSpriteState(win, true);
  }
}

/**
 * Hide the sprite window
 */
export function hideSprite(): void {
  const win = getSpriteWindow();
  if (win) {
    win.hide();
    void saveSpriteState(win, false);
  }
}

/**
 * Toggle sprite window visibility
 */
export function toggleSprite(): void {
  const win = getSpriteWindow();
  if (!win) return;

  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
  }
}
