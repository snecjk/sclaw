import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

function readManifestVersion(manifestPath: string): string | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

function extensionRoots(): string[] {
  const roots = new Set<string>();
  roots.add(join(app.getAppPath(), 'browser-extension'));
  if (process.resourcesPath) {
    roots.add(join(process.resourcesPath, 'browser-extension'));
  }
  return Array.from(roots);
}

export function getBundledBrowserBridgeExtensionVersion(): string {
  for (const root of extensionRoots()) {
    const version = readManifestVersion(join(root, 'manifest.json'));
    if (version) return version;
  }
  return '1.0.0';
}

export function resolveBrowserBridgeExtensionZipPath(): string | null {
  const version = getBundledBrowserBridgeExtensionVersion();
  const zipName = `stoclaw-browser-bridge-${version}.zip`;

  for (const root of extensionRoots()) {
    const zipPath = join(root, 'dist', zipName);
    if (existsSync(zipPath)) return zipPath;
  }

  for (const root of extensionRoots()) {
    const legacyZip = join(root, 'dist', 'stoclaw-browser-bridge-1.0.0.zip');
    if (existsSync(legacyZip)) return legacyZip;
  }

  return null;
}
