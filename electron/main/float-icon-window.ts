/**
 * Float Icon Window Management
 * Creates and manages the desktop floating icon (桌面悬浮图标)
 * A small always-on-top circular icon that toggles the sprite assistant window.
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { isQuitting } from './app-state';

let floatIconWindow: BrowserWindow | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let floatIconStore: any = null;

interface FloatIconState {
  x?: number;
  y?: number;
  visible: boolean;
}

const ICON_SIZE = 56;

async function getStore() {
  if (!floatIconStore) {
    const Store = (await import('electron-store')).default;
    floatIconStore = new Store<{ floatIconState: FloatIconState }>({
      name: 'float-icon-state',
      defaults: {
        floatIconState: { visible: false },
      },
    });
  }
  return floatIconStore;
}

/**
 * Get saved float icon position with display bounds validation
 */
async function getFloatIconPosition(): Promise<{ x: number; y: number }> {
  const store = await getStore();
  const state: FloatIconState = store.get('floatIconState');

  if (state.x !== undefined && state.y !== undefined) {
    const displays = screen.getAllDisplays();
    const isVisible = displays.some((display) => {
      const { x, y, width, height } = display.bounds;
      return (
        state.x! >= x - 16 &&
        state.x! < x + width &&
        state.y! >= y - 16 &&
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
    x: workX + width - ICON_SIZE - 40,
    y: workY + height - ICON_SIZE - 40,
  };
}

async function saveFloatIconState(win: BrowserWindow, visible?: boolean): Promise<void> {
  const store = await getStore();
  const bounds = win.getBounds();
  const current: FloatIconState = store.get('floatIconState');
  store.set('floatIconState', {
    x: bounds.x,
    y: bounds.y,
    visible: visible !== undefined ? visible : current.visible,
  });
}

/**
 * Create the floating icon window
 */
export function createFloatIconWindow(): BrowserWindow {
  if (floatIconWindow && !floatIconWindow.isDestroyed()) {
    return floatIconWindow;
  }

  const win = new BrowserWindow({
    width: ICON_SIZE,
    height: ICON_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  // Restore saved position and visibility
  void (async () => {
    const pos = await getFloatIconPosition();
    if (!win.isDestroyed()) {
      win.setPosition(pos.x, pos.y);
    }

    const store = await getStore();
    const state: FloatIconState = store.get('floatIconState');
    const shouldShow = state.visible !== false;
    if (shouldShow && !win.isDestroyed()) {
      win.show();
    }
    // Update tray menu with actual visibility state after initialization
    const { updateFloatIconVisible } = await import('./tray');
    updateFloatIconVisible(shouldShow);
  })();

  // Load the float-icon route
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/float-icon`);
  } else {
    void win.loadFile(join(__dirname, '../../dist/index.html'), {
      hash: '/float-icon',
    });
  }

  win.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (floatIconWindow === win) {
      floatIconWindow = null;
    }
  });

  // Save position on move (for drag persistence)
  win.on('move', () => {
    void saveFloatIconState(win);
  });

  floatIconWindow = win;
  return win;
}

export function getFloatIconWindow(): BrowserWindow | null {
  if (floatIconWindow && !floatIconWindow.isDestroyed()) {
    return floatIconWindow;
  }
  return null;
}

export function showFloatIcon(): void {
  const win = getFloatIconWindow();
  if (win) {
    win.show();
    void saveFloatIconState(win, true);
    // Update tray menu checkbox state
    import('./tray').then(({ updateFloatIconVisible }) => {
      updateFloatIconVisible(true);
    });
  }
}

export function hideFloatIcon(): void {
  const win = getFloatIconWindow();
  if (win) {
    win.hide();
    void saveFloatIconState(win, false);
    // Update tray menu checkbox state
    import('./tray').then(({ updateFloatIconVisible }) => {
      updateFloatIconVisible(false);
    });
  }
}

export function toggleFloatIcon(): void {
  const win = getFloatIconWindow();
  if (!win) return;
  if (win.isVisible()) {
    hideFloatIcon();
  } else {
    showFloatIcon();
  }
}

export function isFloatIconVisible(): boolean {
  const win = getFloatIconWindow();
  return !!win && win.isVisible();
}

/**
 * Toggle the sprite window, positioning it near the float icon.
 * Called when the user clicks the floating icon.
 */
export async function toggleSpriteNearIcon(): Promise<void> {
  const { getSpriteWindow, createSpriteWindow, showSprite, hideSprite } = await import('./sprite-window');

  let spriteWin = getSpriteWindow();
  if (!spriteWin) {
    createSpriteWindow();
    spriteWin = getSpriteWindow();
  }

  if (!spriteWin) return;

  // If sprite is visible, just hide it
  if (spriteWin.isVisible()) {
    hideSprite();
    return;
  }

  // Position sprite near the float icon
  const iconWin = getFloatIconWindow();
  if (iconWin && !iconWin.isDestroyed()) {
    const iconBounds = iconWin.getBounds();
    const display = screen.getDisplayNearestPoint({ x: iconBounds.x, y: iconBounds.y });
    const workArea = display.workArea;

    const spriteW = 380;
    const spriteH = 520;
    const gap = 8;

    // Determine which quadrant the icon is in
    const iconCenterX = iconBounds.x + iconBounds.width / 2;
    const iconCenterY = iconBounds.y + iconBounds.height / 2;
    const areaCenterX = workArea.x + workArea.width / 2;
    const areaCenterY = workArea.y + workArea.height / 2;

    let spriteX: number;
    let spriteY: number;

    if (iconCenterX >= areaCenterX) {
      // Icon is on the right half -> sprite to the left
      spriteX = iconBounds.x - spriteW - gap;
    } else {
      // Icon is on the left half -> sprite to the right
      spriteX = iconBounds.x + iconBounds.width + gap;
    }

    if (iconCenterY >= areaCenterY) {
      // Icon is in the bottom half -> sprite above, bottom-aligned with icon
      spriteY = iconBounds.y + iconBounds.height - spriteH;
    } else {
      // Icon is in the top half -> sprite below, top-aligned with icon
      spriteY = iconBounds.y;
    }

    // Clamp to work area
    spriteX = Math.max(workArea.x, Math.min(spriteX, workArea.x + workArea.width - spriteW));
    spriteY = Math.max(workArea.y, Math.min(spriteY, workArea.y + workArea.height - spriteH));

    spriteWin.setPosition(Math.round(spriteX), Math.round(spriteY));
  }

  showSprite();
}
