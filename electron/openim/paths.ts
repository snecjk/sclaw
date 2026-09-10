import { app, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OpenIMPaths {
  dataDir: string;
  logDir: string;
}

export function ensureOpenIMPaths(userID?: string): OpenIMPaths {
  const safeUserID = (userID || 'default').replace(/[^\w.-]/g, '_');
  const dataDir = join(app.getPath('userData'), 'openim', safeUserID);
  const logDir = join(dataDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  return { dataDir, logDir };
}

/**
 * Electron OpenIM uploadFile JSON.stringifies params — File blobs become `{}`.
 * Materialize renderer bytes onto disk so native upload can open a real filepath.
 * Prefer Host API `/api/files/stage-buffer` from renderer; this IPC remains as a spare.
 */
function writeTempUploadFile(payload: {
  fileName?: string;
  base64: string;
}): { filepath: string } {
  if (!payload?.base64 || typeof payload.base64 !== 'string') {
    throw new Error('openim:writeTempUploadFile requires base64');
  }
  const rawName = (payload.fileName || 'image.png').replace(/[^\w.\-()+ ]+/g, '_');
  const ext = extname(rawName) || '.png';
  const base = rawName.slice(0, Math.max(1, rawName.length - ext.length)) || 'image';
  const dir = join(tmpdir(), 'stoclaw-openim-upload');
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, `${base}-${randomUUID()}${ext}`);
  writeFileSync(filepath, Buffer.from(payload.base64, 'base64'));
  return { filepath };
}

/** Always re-bind so HMR / re-import picks up newly added channels. */
export function registerOpenIMIpcHandlers(): void {
  ipcMain.removeHandler('openim:ensureDirs');
  ipcMain.removeHandler('openim:writeTempUploadFile');
  ipcMain.handle('openim:ensureDirs', (_, userID?: string) => ensureOpenIMPaths(userID));
  ipcMain.handle('openim:writeTempUploadFile', (_, payload: { fileName?: string; base64: string }) => (
    writeTempUploadFile(payload)
  ));
}
