import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { JSBRIDGE_GUEST_PRELOAD_CJS } from '../../shared/jsbridge-guest-preload-source';

/** Resolve absolute path to guest preload script (materialized under userData). */
export function getJsBridgeGuestPreloadPath(): string {
  const dir = join(app.getPath('userData'), 'jsbridge');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'jsbridge-guest-preload.cjs');
  // Always rewrite so dev/main-process restarts pick up preload changes.
  writeFileSync(filePath, JSBRIDGE_GUEST_PRELOAD_CJS, 'utf8');
  return filePath;
}

/** file:// URL for webview preload attribute. */
export function getJsBridgeGuestPreloadUrl(): string {
  const path = getJsBridgeGuestPreloadPath();
  // Windows paths must be file:///C:/... — string concat breaks on win32.
  return pathToFileURL(path).href;
}
