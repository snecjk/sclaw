/**
 * Drives browser-bridge commands against embed webviews (no Chrome extension).
 */
import { webContents } from 'electron';
import type { BrowserBridgeAction, BrowserBridgeCommand } from '../../../shared/browser-bridge/types';
import {
  buildSclawEmbedBridgeSessionId,
  SCLAW_EMBED_BRIDGE_INJECT_SCRIPT,
} from '../../../shared/sclaw-embed-bridge-inject';
import { browserBridgeService } from '../../services/browser-bridge-service';

const EMBED_TAB_ID = -1;
const POLL_INTERVAL_MS = 200;

interface EmbedDriverEntry {
  runtimeId: string;
  sessionId: string;
  webContentsId: number;
}

const entries = new Map<string, EmbedDriverEntry>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function ensurePollLoop(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void tickAll();
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

function stopPollLoopIfIdle(): void {
  if (entries.size > 0 || !pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function resolveWebContents(webContentsId: number) {
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return null;
  return wc;
}

async function injectBridgeScript(webContentsId: number): Promise<void> {
  const wc = resolveWebContents(webContentsId);
  if (!wc) return;
  try {
    await wc.executeJavaScript(SCLAW_EMBED_BRIDGE_INJECT_SCRIPT);
  } catch {
    // Page may block injection during navigation — retry on next command.
  }
}

async function runEmbedCommand(
  entry: EmbedDriverEntry,
  action: BrowserBridgeAction,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const wc = resolveWebContents(entry.webContentsId);
  if (!wc) {
    return { success: false, error: 'Embed webview is not ready' };
  }

  if (action === 'navigate') {
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) return { success: false, error: 'url is required' };
    await wc.loadURL(url);
    return { success: true, url };
  }

  if (action === 'screenshot') {
    const image = await wc.capturePage();
    return {
      success: true,
      mimeType: 'image/png',
      dataUrl: image.toDataURL(),
    };
  }

  await injectBridgeScript(entry.webContentsId);

  const script = `window.__stoEmbedBridge && window.__stoEmbedBridge.executeCommand(
    ${JSON.stringify(action)},
    ${JSON.stringify(payload)}
  )`;

  try {
    return await wc.executeJavaScript(script);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function executeCommand(entry: EmbedDriverEntry, command: BrowserBridgeCommand): Promise<void> {
  const result = await runEmbedCommand(entry, command.action, command.payload);
  browserBridgeService.storeResult({
    sessionId: entry.sessionId,
    commandId: command.commandId,
    action: command.action,
    result,
  });
}

async function tickEntry(entry: EmbedDriverEntry): Promise<void> {
  browserBridgeService.heartbeat(entry.sessionId);
  const commands = browserBridgeService.pollCommands(entry.sessionId);
  for (const command of commands) {
    await executeCommand(entry, command);
  }
}

async function tickAll(): Promise<void> {
  for (const entry of entries.values()) {
    await tickEntry(entry);
  }
}

export function connectSclawEmbedBridge(input: {
  runtimeId: string;
  webContentsId: number;
  url: string;
  title: string;
}): void {
  const sessionId = buildSclawEmbedBridgeSessionId(input.runtimeId);
  browserBridgeService.connectEmbedSession({
    sessionId,
    embedRuntimeId: input.runtimeId,
    tabId: EMBED_TAB_ID,
    url: input.url,
    title: input.title,
  });

  entries.set(input.runtimeId, {
    runtimeId: input.runtimeId,
    sessionId,
    webContentsId: input.webContentsId,
  });

  ensurePollLoop();
  void injectBridgeScript(input.webContentsId);
}

export function updateSclawEmbedBridgePage(input: {
  runtimeId: string;
  pageUrl?: string;
  pageTitle?: string;
}): void {
  const entry = entries.get(input.runtimeId);
  if (!entry) return;
  browserBridgeService.heartbeat(entry.sessionId, {
    url: input.pageUrl,
    title: input.pageTitle,
  });
  if (entry.webContentsId) {
    void injectBridgeScript(entry.webContentsId);
  }
}

export function disconnectSclawEmbedBridge(runtimeId: string): void {
  const entry = entries.get(runtimeId);
  if (!entry) return;
  browserBridgeService.disconnectSession(entry.sessionId);
  entries.delete(runtimeId);
  stopPollLoopIfIdle();
}

export async function refreshSclawEmbedBridgeScript(runtimeId: string): Promise<void> {
  const entry = entries.get(runtimeId);
  if (!entry) return;
  await injectBridgeScript(entry.webContentsId);
}
