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
      sandbox: true,
    },
  });

  managedWindows.set(sessionId, { window: win, sessionId });

  win.on('closed', () => {
    managedWindows.delete(sessionId);
  });

  await win.loadURL(input.url);
  return { sessionId, webContents: win.webContents };
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
