import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, clipboard, shell } from 'electron';

export const BROWSER_BRIDGE_EXTENSION_DISPLAY_NAME = 'SClaw Web Bridge';
export const BROWSER_BRIDGE_EXTENSION_ZIP_SLUG = 'sclaw-web-bridge';
const LEGACY_ZIP_SLUG = 'stoclaw-browser-bridge';

export const BROWSER_BRIDGE_EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'cdp-allowlist.js',
  'page-agent.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
] as const;

export function listBrowserBridgeExtensionZipNames(version: string): string[] {
  return [
    `${BROWSER_BRIDGE_EXTENSION_ZIP_SLUG}-${version}.zip`,
    `${LEGACY_ZIP_SLUG}-${version}.zip`,
    `${LEGACY_ZIP_SLUG}-1.0.0.zip`,
  ];
}

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
  roots.add(join(process.cwd(), 'browser-extension'));
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
  const zipNames = listBrowserBridgeExtensionZipNames(version);

  for (const zipName of zipNames) {
    for (const root of extensionRoots()) {
      const zipPath = join(root, 'dist', zipName);
      if (existsSync(zipPath)) return zipPath;
    }
  }

  return null;
}

function findUnpackedSourceRoot(): string | null {
  for (const root of extensionRoots()) {
    if (existsSync(join(root, 'background.js')) && existsSync(join(root, 'manifest.json'))) {
      return root;
    }
  }
  return null;
}

export function getUnpackedBrowserBridgeExtensionDir(): string {
  return join(app.getPath('userData'), 'browser-extension', 'sclaw-web-bridge');
}

export async function materializeUnpackedBrowserBridgeExtension(): Promise<string> {
  const dest = getUnpackedBrowserBridgeExtensionDir();
  const source = findUnpackedSourceRoot();
  if (source) {
    mkdirSync(join(dest, 'icons'), { recursive: true });
    for (const file of BROWSER_BRIDGE_EXTENSION_FILES) {
      const from = join(source, file);
      if (!existsSync(from)) {
        throw new Error(`Missing extension file: ${file}`);
      }
      const to = join(dest, file);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    return dest;
  }

  const zipPath = resolveBrowserBridgeExtensionZipPath();
  if (!zipPath) {
    throw new Error('Extension package not found');
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const { extractZip } = await import('./zip-extract');
  await extractZip(zipPath, dest);
  if (!existsSync(join(dest, 'manifest.json'))) {
    throw new Error('Extension extract did not produce manifest.json');
  }
  return dest;
}

export function launchGoogleChrome(targetUrl?: string): boolean {
  const url = typeof targetUrl === 'string' && targetUrl.trim() ? targetUrl.trim() : undefined;
  try {
    if (process.platform === 'darwin') {
      const chromeApp = '/Applications/Google Chrome.app';
      if (!existsSync(chromeApp)) return false;
      const args = url ? ['-a', 'Google Chrome', url] : ['-a', 'Google Chrome'];
      const child = spawn('open', args, { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    if (process.platform === 'win32') {
      const candidates = [
        join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
      const exe = candidates.find((candidate) => candidate && existsSync(candidate));
      if (!exe) return false;
      const child = spawn(exe, url ? [url] : [], { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    const child = spawn('google-chrome', url ? [url] : [], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function prepareBrowserBridgeExtensionInstall(): Promise<{
  unpackedDir: string;
  version: string;
  folderRevealed: boolean;
  chromeOpened: boolean;
}> {
  const unpackedDir = await materializeUnpackedBrowserBridgeExtension();
  clipboard.writeText(unpackedDir);
  const manifestPath = join(unpackedDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    shell.showItemInFolder(manifestPath);
  } else {
    await shell.openPath(unpackedDir);
  }
  return {
    unpackedDir,
    version: getBundledBrowserBridgeExtensionVersion(),
    folderRevealed: true,
    chromeOpened: launchGoogleChrome(),
  };
}
