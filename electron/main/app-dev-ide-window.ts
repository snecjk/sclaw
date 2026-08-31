import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { getClientAppIcon } from './app-icon';
import { logger } from '../utils/logger';
import { safeWebContentsSend } from './safe-web-contents-send';

const ideWindows = new Map<string, BrowserWindow>();

function encodeWorkspaceId(workspaceId: string): string {
  return encodeURIComponent(workspaceId.trim());
}

function broadcastOwnership(workspaceId: string, open: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    safeWebContentsSend(win.webContents, 'app-dev-ide:ownership', { workspaceId, open });
  }
}

function loadIdeRoute(win: BrowserWindow, workspaceId: string): void {
  const hash = `/app-dev-ide/${encodeWorkspaceId(workspaceId)}`;
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`);
    return;
  }
  void win.loadFile(join(__dirname, '../../dist/index.html'), { hash });
}

export function isAppDevIdeOpen(workspaceId: string): boolean {
  const win = ideWindows.get(workspaceId);
  return Boolean(win && !win.isDestroyed());
}

export function listOpenAppDevIdeWorkspaceIds(): string[] {
  return [...ideWindows.entries()]
    .filter(([, win]) => !win.isDestroyed())
    .map(([workspaceId]) => workspaceId);
}

export function focusAppDevIdeWindow(workspaceId: string): boolean {
  const win = ideWindows.get(workspaceId);
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

export function openAppDevIdeWindow(input: { workspaceId: string; title?: string }): BrowserWindow {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) throw new Error('workspaceId 不能为空');
  const existing = ideWindows.get(workspaceId);
  if (existing && !existing.isDestroyed()) {
    focusAppDevIdeWindow(workspaceId);
    return existing;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    icon: getClientAppIcon(),
    title: input.title ? `${input.title} — 编辑器` : '应用编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
    frame: true,
    show: false,
    backgroundColor: '#0f1525',
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  win.on('closed', () => {
    if (ideWindows.get(workspaceId) === win) {
      ideWindows.delete(workspaceId);
      broadcastOwnership(workspaceId, false);
    }
  });

  ideWindows.set(workspaceId, win);
  loadIdeRoute(win, workspaceId);
  broadcastOwnership(workspaceId, true);
  logger.info(`[app-dev-ide] opened workspace=${workspaceId}`);
  return win;
}
