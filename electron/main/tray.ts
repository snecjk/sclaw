/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import { getCurrentEnvConfig } from '../../shared/env-config';

const envConfig = getCurrentEnvConfig();
const envSuffix = envConfig.displaySuffix ? ` ${envConfig.displaySuffix}` : '';

let tray: Tray | null = null;
let floatIconVisible = false; // Track float icon visibility state
let mainWindowRef: BrowserWindow | null = null;
let onToggleFloatIconCallback: (() => void) | undefined;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Build context menu
 */
function buildContextMenu(): Menu {
  const showWindow = () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    mainWindowRef.show();
    mainWindowRef.focus();
  };

  return Menu.buildFromTemplate([
    {
      label: `显示 SClaw${envSuffix}`,
      click: showWindow,
    },
    {
      label: '显示精灵',
      type: 'checkbox',
      checked: floatIconVisible,
      click: () => {
        onToggleFloatIconCallback?.();
      },
    },
    {
      type: 'separator',
    },
    {
      label: '网关状态',
      enabled: false,
    },
    {
      label: '  运行中',
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: '快捷操作',
      submenu: [
        {
          label: '打开聊天',
          click: () => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.show();
            mainWindowRef.webContents.send('navigate', '/');
          },
        },
        {
          label: '打开设置',
          click: () => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.show();
            mainWindowRef.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: '检查更新...',
      click: () => {
        if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
        mainWindowRef.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: `退出 SClaw${envSuffix}`,
      click: () => {
        app.quit();
      },
    },
  ]);
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow, _onToggleSprite?: () => void, onToggleFloatIcon?: () => void): Tray {
  // Store references for menu rebuilding
  mainWindowRef = mainWindow;
  onToggleFloatIconCallback = onToggleFloatIcon;

  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);

  // Set tooltip
  tray.setToolTip(`SClaw - AI 助手${envSuffix}`);

  tray.setContextMenu(buildContextMenu());

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    tray.setToolTip(`SClaw - ${status}`);
  }
}

/**
 * Update float icon visibility state and rebuild menu
 */
export function updateFloatIconVisible(visible: boolean): void {
  floatIconVisible = visible;
  if (tray) {
    tray.setContextMenu(buildContextMenu());
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
