import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { JSBRIDGE_GUEST_PRELOAD_CJS } from '../../shared/jsbridge-guest-preload-source';

let cachedPath: string | null = null;

/** Resolve absolute path to guest preload script (materialized under userData). */
export function getJsBridgeGuestPreloadPath(): string {
  if (cachedPath && existsSync(cachedPath)) {
    return cachedPath;
  }

  const dir = join(app.getPath('userData'), 'jsbridge');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'jsbridge-guest-preload.cjs');
  writeFileSync(filePath, JSBRIDGE_GUEST_PRELOAD_CJS, 'utf8');
  cachedPath = filePath;
  return filePath;
}

/** file:// URL for webview preload attribute. */
export function getJsBridgeGuestPreloadUrl(): string {
  const path = getJsBridgeGuestPreloadPath();
  // Windows paths must be file:///C:/... — string concat breaks on win32.
  return pathToFileURL(path).href;
}
