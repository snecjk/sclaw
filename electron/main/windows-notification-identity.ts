import { app, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_APP_NAME, CLIENT_APP_USER_MODEL_ID } from '../../shared/app-branding';
import { logger } from '../utils/logger';
import { getClientAppIconPath } from './app-icon';

const DEVELOPMENT_SHORTCUT_FOLDER = `${CLIENT_APP_NAME} Development`;

function quoteShortcutArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Give Windows toasts the SClaw identity used by their top attribution row.
 * Packaged installs get the matching Start Menu shortcut from electron-builder;
 * development runs need their own shortcut because they execute electron.exe.
 */
export function configureWindowsNotificationIdentity(): void {
  if (process.platform !== 'win32') return;

  app.setAppUserModelId(CLIENT_APP_USER_MODEL_ID);
  if (app.isPackaged) return;

  try {
    const shortcutDirectory = join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      DEVELOPMENT_SHORTCUT_FOLDER,
    );
    mkdirSync(shortcutDirectory, { recursive: true });
    const shortcutPath = join(shortcutDirectory, `${CLIENT_APP_NAME}.lnk`);
    const appPath = app.getAppPath();
    const written = shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: quoteShortcutArgument(appPath),
      cwd: appPath,
      description: CLIENT_APP_NAME,
      icon: getClientAppIconPath(),
      iconIndex: 0,
      appUserModelId: CLIENT_APP_USER_MODEL_ID,
      toastActivatorClsid: app.toastActivatorCLSID,
    });
    if (!written) {
      logger.warn('[notification-identity] unable to register the development Start Menu shortcut');
    }
  } catch (error) {
    logger.warn('[notification-identity] failed to register the development toast identity', error);
  }
}
