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
import { cdpMethodTimeoutMs, isCdpMethodAllowed } from '../../../shared/browser-automation/cdp-allowlist';
import { BrowserAutomationCdpSession } from '../../services/browser-automation/cdp-session';
import { actFillOrType, getOrCreateCdpSession } from '../../services/browser-automation/input';
import { collectReadPageText, paginateReadPageText } from '../../services/browser-automation/read-page';
import { sendSclawEmbedAutomationMark } from './sclaw-embed-automation-mark';

const EMBED_TAB_ID = -1;
const POLL_INTERVAL_MS = 50;
const EMBED_CLICK_NAV_WAIT_MS = 2500;

interface EmbedDriverEntry {
  runtimeId: string;
  sessionId: string;
  webContentsId: number;
}

const entries = new Map<string, EmbedDriverEntry>();
const embedCdpByWebContentsId = new Map<number, BrowserAutomationCdpSession>();
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEmbedNavigation(
  wc: NonNullable<ReturnType<typeof resolveWebContents>>,
  startUrl: string,
  timeoutMs = EMBED_CLICK_NAV_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wc.isDestroyed()) return;
    const currentUrl = wc.getURL();
    if (currentUrl !== startUrl && !wc.isLoading()) return;
    await sleep(50);
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

  if (action === 'group_tabs' || action === 'mark_tabs') {
    return { success: false, error: 'unsupported on embed' };
  }

  if (action === 'cdp') {
    const method = typeof payload.method === 'string' ? payload.method : '';
    if (!method || !isCdpMethodAllowed(method)) {
      return { success: false, error: 'CDP_METHOD_NOT_ALLOWED' };
    }
    const cdp = getOrCreateCdpSession(wc, embedCdpByWebContentsId);
    const params = payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
      ? payload.params as Record<string, unknown>
      : undefined;
    try {
      const result = await cdp.send(method, params, { timeoutMs: cdpMethodTimeoutMs(method) });
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  if (action === 'print_pdf') {
    try {
      const data = await wc.printToPDF({ printBackground: true });
      return { success: true, mimeType: 'application/pdf', base64: data.toString('base64') };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  if (action === 'read_page') {
    const collected = await collectReadPageText({
      executeJavaScript: (script) => wc.executeJavaScript(script, true),
    });
    return { success: true, ...paginateReadPageText(collected) };
  }

  if (action === 'navigate') {
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) return { success: false, error: 'url is required' };
    await wc.loadURL(url);
    return { success: true, url: wc.getURL(), title: wc.getTitle() };
  }

  if (action === 'screenshot') {
    const image = await wc.capturePage();
    return {
      success: true,
      mimeType: 'image/png',
      dataUrl: image.toDataURL(),
    };
  }

  if (action === 'fill') {
    const cdp = getOrCreateCdpSession(wc, embedCdpByWebContentsId);
    const executeJavaScript = async (script: string) => wc.executeJavaScript(script, true);
    const fillResult = await actFillOrType({
      cdp,
      executeJavaScript,
      payload: {
        action: 'fill',
        ref: typeof payload.ref === 'string' ? payload.ref : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        value: typeof payload.value === 'string' ? payload.value : String(payload.value ?? ''),
      },
    });
    return {
      success: fillResult.success,
      ref: fillResult.ref,
      value: payload.value,
      error: fillResult.error,
    };
  }

  await injectBridgeScript(entry.webContentsId);

  const script = `window.__stoEmbedBridge && window.__stoEmbedBridge.executeCommand(
    ${JSON.stringify(action)},
    ${JSON.stringify(payload)}
  )`;

  try {
    const startUrl = wc.getURL();
    const result = await wc.executeJavaScript(script) as {
      success?: boolean;
      ref?: string;
      error?: string;
    } | null;
    if (action === 'click' && result?.success) {
      await waitForEmbedNavigation(wc, startUrl);
      return {
        ...result,
        url: wc.getURL(),
        title: wc.getTitle(),
        navigated: wc.getURL() !== startUrl,
      };
    }
    return result;
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function executeCommand(entry: EmbedDriverEntry, command: BrowserBridgeCommand): Promise<void> {
  sendSclawEmbedAutomationMark(entry.webContentsId, entry.runtimeId, true);
  try {
    const result = await runEmbedCommand(entry, command.action, command.payload);
    browserBridgeService.storeResult({
      sessionId: entry.sessionId,
      commandId: command.commandId,
      action: command.action,
      result,
    });
  } finally {
    sendSclawEmbedAutomationMark(entry.webContentsId, entry.runtimeId, false);
  }
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

/** Run queued embed bridge commands immediately instead of waiting for the poll loop. */
export function flushSclawEmbedBridgeSession(sessionId: string): void {
  const runtimeId = sessionId.startsWith('embed-') ? sessionId.slice('embed-'.length) : '';
  if (!runtimeId) return;
  const entry = entries.get(runtimeId);
  if (!entry) return;
  void tickEntry(entry);
}
