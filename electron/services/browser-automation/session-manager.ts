import { randomUUID } from 'node:crypto';
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import { prepareSclawEmbedBrowserSession } from '../../main/services/sclaw-embed-browser-session';
import {
  ensureSclawEmbedBridgeForRuntime,
  getSclawEmbedBrowserRuntime,
} from '../../main/services/sclaw-embed-browser-runtime';
import type { BrowserAutomationSession } from '../../../shared/browser-automation/types';
import { BROWSER_AUTOMATION_SESSION_IDLE_MS } from '../../../shared/browser-automation/types';
import { logger } from '../../utils/logger';

interface ManagedWindowEntry {
  window: BrowserWindow;
  sessionId: string;
}

const managedWindows = new Map<string, ManagedWindowEntry>();

export function resolveEmbedWebContents(runtimeId: string): WebContents | null {
  ensureSclawEmbedBridgeForRuntime(runtimeId);
  const meta = getSclawEmbedBrowserRuntime(runtimeId);
  if (!meta?.webContentsId) return null;
  return webContents.fromId(meta.webContentsId) ?? null;
}

export async function createManagedSession(input: {
  url: string;
  show?: boolean;
}): Promise<{ sessionId: string; webContents: WebContents }> {
  const sessionId = `managed-${randomUUID()}`;
  await prepareSclawEmbedBrowserSession(input.url);

  const win = new BrowserWindow({
    show: input.show ?? false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: SCLAW_EMBED_BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  managedWindows.set(sessionId, { window: win, sessionId });

  win.on('closed', () => {
    managedWindows.delete(sessionId);
  });

  // B2/B9：beforeunload 不触发 CDP javascriptDialogOpening，直接阻止其打断自动化会话
  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  await win.loadURL(input.url);
  const prefix = '[自动操作] ';
  const applyAutomationTitle = () => {
    if (win.isDestroyed()) return;
    const current = win.getTitle() || input.url;
    if (!current.startsWith(prefix)) {
      win.setTitle(`${prefix}${current}`);
    }
  };
  applyAutomationTitle();
  win.on('page-title-updated', (event, title) => {
    if (title.startsWith(prefix)) return;
    event.preventDefault();
    win.setTitle(`${prefix}${title}`);
  });
  return { sessionId, webContents: win.webContents };
}

/** B7 可见性守卫数据源：managed 窗口的可见/最小化状态；窗口不存在（已销毁）返回 null。 */
export function getManagedWindowVisibility(
  sessionId: string,
): { visible: boolean; minimized: boolean } | null {
  const managed = managedWindows.get(sessionId);
  if (!managed || managed.window.isDestroyed()) return null;
  return { visible: managed.window.isVisible(), minimized: managed.window.isMinimized() };
}

export function resolveSessionWebContents(session: BrowserAutomationSession): WebContents | null {
  if (session.source === 'embed' && session.embedRuntimeId) {
    return resolveEmbedWebContents(session.embedRuntimeId);
  }
  const managed = managedWindows.get(session.sessionId);
  if (managed && !managed.window.isDestroyed()) {
    return managed.window.webContents;
  }
  return null;
}

export function closeManagedSession(sessionId: string): void {
  const managed = managedWindows.get(sessionId);
  if (!managed || managed.window.isDestroyed()) return;
  managed.window.close();
  managedWindows.delete(sessionId);
}

/** 仅 owned 会话可销毁窗口；borrowed（embed）只取消注册、不关用户 webview。 */
export function closeOwnedSession(session: { ownership?: string; source?: string; sessionId: string }): void {
  if (session.ownership === 'borrowed') return;
  if (session.source === 'managed' || session.ownership === 'owned') {
    closeManagedSession(session.sessionId);
  }
}

export function buildEmbedSessionId(runtimeId: string): string {
  return `embed-${runtimeId}`;
}

export function parseEmbedRuntimeId(sessionId: string): string | null {
  if (!sessionId.startsWith('embed-')) return null;
  return sessionId.slice('embed-'.length) || null;
}

export function isSessionExpired(lastActiveAt: number, automationPinned: boolean): boolean {
  if (automationPinned) return false;
  return Date.now() - lastActiveAt > BROWSER_AUTOMATION_SESSION_IDLE_MS;
}

export function logSessionEvent(message: string, extra?: Record<string, unknown>): void {
  logger.info(`[browser-automation] ${message}`, extra ?? {});
}

export async function navigateWebContents(wc: WebContents, url: string): Promise<void> {
  if (wc.isDestroyed()) throw new Error('WebContents destroyed');
  await prepareSclawEmbedBrowserSession(url);
  await wc.loadURL(url);
}
