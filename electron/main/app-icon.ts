import { app, nativeImage, type NativeImage } from 'electron';
import { join } from 'node:path';

function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/** Resolve the canonical client icon for windows and native notifications. */
export function getClientAppIcon(): NativeImage | undefined {
  if (process.platform === 'darwin' && app.isPackaged) {
    return undefined;
  }

  const iconPath = join(
    getIconsDir(),
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}
