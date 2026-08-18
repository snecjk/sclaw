/**
 * Main-process registry: binds embed chat sessions to webview webContents.
 * Enables page capture, script execution, and network monitoring for agent tools.
 */
import { session, webContents } from 'electron';
import {
  SCLAW_EMBED_BROWSER_NETWORK_LOG_LIMIT,
  SCLAW_EMBED_BROWSER_VISIBLE_TEXT_LIMIT,
  type SclawEmbedBrowserNetworkEvent,
  type SclawEmbedBrowserPageSnapshot,
  type SclawEmbedBrowserRuntimeMeta,
} from '../../../shared/sclaw-embed-browser-runtime';
import { SCLAW_EMBED_BROWSER_PARTITION } from '../../../shared/sclaw-embed-browser';
import {
  connectSclawEmbedBridge,
  disconnectSclawEmbedBridge,
  updateSclawEmbedBridgePage,
} from './sclaw-embed-bridge-driver';
import {
  attachSclawEmbedBrowserShortcutHandler,
  detachSclawEmbedBrowserShortcutHandler,
} from './sclaw-embed-browser-shortcuts';
import {
  attachSclawEmbedBrowserWindowOpenHandler,
  detachSclawEmbedBrowserWindowOpenHandler,
} from './sclaw-embed-browser-window-open';
import {
  createBridgeSession,
  destroyBridgeSessionsForRuntime,
  toBridgeBootstrap,
} from './jsbridge/session-registry';

interface RuntimeEntry extends SclawEmbedBrowserRuntimeMeta {
  networkLog: SclawEmbedBrowserNetworkEvent[];
}

const runtimes = new Map<string, RuntimeEntry>();
const chatSessionIndex = new Map<string, string>();

const PAGE_CAPTURE_SCRIPT = `(function() {
  try {
    var title = document.title || '';
    var url = location.href || '';
    var clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return { title: title, url: url, text: '' };
    var remove = clone.querySelectorAll('script,style,noscript,svg,iframe');
    for (var i = 0; i < remove.length; i++) remove[i].remove();
    var text = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > ${SCLAW_EMBED_BROWSER_VISIBLE_TEXT_LIMIT}) {
      text = text.slice(0, ${SCLAW_EMBED_BROWSER_VISIBLE_TEXT_LIMIT}) + '…';
    }
    return { title: title, url: url, text: text };
  } catch (err) {
    return { title: document.title || '', url: location.href || '', text: '' };
  }
})()`;

let networkHookInstalled = false;

function ensureRuntime(runtimeId: string): RuntimeEntry {
  const entry = runtimes.get(runtimeId);
  if (!entry) {
    throw new Error(`Embed browser runtime not found: ${runtimeId}`);
  }
  return entry;
}

function resolveWebContents(entry: RuntimeEntry) {
  if (!entry.webContentsId) return null;
  return webContents.fromId(entry.webContentsId) ?? null;
}

function pushNetworkEvent(entry: RuntimeEntry, event: SclawEmbedBrowserNetworkEvent): void {
  entry.networkLog.push(event);
  while (entry.networkLog.length > SCLAW_EMBED_BROWSER_NETWORK_LOG_LIMIT) {
    entry.networkLog.shift();
  }
}

function ensureEmbedNetworkHook(): void {
  if (networkHookInstalled) return;
  networkHookInstalled = true;

  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  embedSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
    for (const entry of runtimes.values()) {
      if (entry.webContentsId !== details.webContentsId) continue;
      pushNetworkEvent(entry, {
        method: details.method,
        url: details.url,
        statusCode: details.statusCode,
        resourceType: details.resourceType,
        timestamp: Date.now(),
      });
      break;
    }
  });
}

function attachNetworkMonitor(runtimeId: string, webContentsId: number): void {
  ensureEmbedNetworkHook();
  const entry = ensureRuntime(runtimeId);
  entry.webContentsId = webContentsId;
}

export function registerSclawEmbedBrowserRuntime(input: {
  runtimeId: string;
  appTitle: string;
  initialUrl: string;
  appId?: string;
  bound?: boolean;
}): SclawEmbedBrowserRuntimeMeta {
  const now = Date.now();
  const entry: RuntimeEntry = {
    runtimeId: input.runtimeId,
    chatSessionKey: null,
    appTitle: input.appTitle,
    initialUrl: input.initialUrl,
    pageUrl: input.initialUrl,
    pageTitle: '',
    webContentsId: null,
    appId: input.appId?.trim() || null,
    bound: Boolean(input.bound),
    bridgeBootstrap: null,
    createdAt: now,
    boundAt: null,
    networkLog: [],
  };
  runtimes.set(input.runtimeId, entry);
  return { ...entry };
}

export function linkSclawEmbedBrowserChatSession(runtimeId: string, chatSessionKey: string): void {
  const entry = ensureRuntime(runtimeId);
  if (entry.chatSessionKey && entry.chatSessionKey !== chatSessionKey) {
    chatSessionIndex.delete(entry.chatSessionKey);
  }
  entry.chatSessionKey = chatSessionKey;
  chatSessionIndex.set(chatSessionKey, runtimeId);
}

export function bindSclawEmbedBrowserWebContents(input: {
  runtimeId: string;
  webContentsId: number;
  pageUrl?: string;
  pageTitle?: string;
}): SclawEmbedBrowserRuntimeMeta {
  const entry = ensureRuntime(input.runtimeId);
  entry.webContentsId = input.webContentsId;
  entry.boundAt = Date.now();
  if (input.pageUrl) entry.pageUrl = input.pageUrl;
  if (input.pageTitle) entry.pageTitle = input.pageTitle;
  attachNetworkMonitor(input.runtimeId, input.webContentsId);
  connectSclawEmbedBridge({
    runtimeId: input.runtimeId,
    webContentsId: input.webContentsId,
    url: entry.pageUrl,
    title: entry.pageTitle || entry.appTitle,
  });
  attachSclawEmbedBrowserShortcutHandler(input.webContentsId);
  attachSclawEmbedBrowserWindowOpenHandler(input.webContentsId, input.runtimeId);

  const pageUrl = entry.pageUrl || input.pageUrl || entry.initialUrl;
  const bridgeSession = createBridgeSession({
    runtimeId: input.runtimeId,
    webContentsId: input.webContentsId,
    pageUrl,
    appId: entry.appId,
    bound: entry.bound,
  });
  if (bridgeSession) {
    entry.bridgeBootstrap = toBridgeBootstrap(bridgeSession);
    const wc = resolveWebContents(entry);
    if (wc && !wc.isDestroyed()) {
      try {
        wc.send('jsbridge:init', entry.bridgeBootstrap);
      } catch {
        // guest preload may not be ready yet
      }
    }
  } else {
    entry.bridgeBootstrap = null;
  }

  return { ...entry };
}

export function updateSclawEmbedBrowserPageState(input: {
  runtimeId: string;
  pageUrl?: string;
  pageTitle?: string;
}): void {
  const entry = runtimes.get(input.runtimeId);
  if (!entry) return;
  if (input.pageUrl) entry.pageUrl = input.pageUrl;
  if (input.pageTitle) entry.pageTitle = input.pageTitle;
  updateSclawEmbedBridgePage({
    runtimeId: input.runtimeId,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
  });
}

export function unregisterSclawEmbedBrowserRuntime(runtimeId: string): void {
  const entry = runtimes.get(runtimeId);
  if (!entry) return;
  setSclawEmbedBrowserPointerPassthrough(runtimeId, false);
  detachSclawEmbedBrowserShortcutHandler(entry.webContentsId);
  detachSclawEmbedBrowserWindowOpenHandler(entry.webContentsId);
  disconnectSclawEmbedBridge(runtimeId);
  destroyBridgeSessionsForRuntime(runtimeId);
  if (entry.chatSessionKey) {
    chatSessionIndex.delete(entry.chatSessionKey);
  }
  runtimes.delete(runtimeId);
}

export function getSclawEmbedBrowserRuntime(runtimeId: string): SclawEmbedBrowserRuntimeMeta | null {
  const entry = runtimes.get(runtimeId);
  return entry ? { ...entry } : null;
}

/** Re-register embed bridge session when webview is bound but driver/session dropped. */
export function ensureSclawEmbedBridgeForRuntime(runtimeId: string): boolean {
  const entry = runtimes.get(runtimeId);
  if (!entry?.webContentsId) return false;
  connectSclawEmbedBridge({
    runtimeId,
    webContentsId: entry.webContentsId,
    url: entry.pageUrl,
    title: entry.pageTitle || entry.appTitle,
  });
  return true;
}

export function resolveSclawEmbedBrowserRuntimeByChatSession(
  chatSessionKey: string,
): SclawEmbedBrowserRuntimeMeta | null {
  const runtimeId = chatSessionIndex.get(chatSessionKey);
  if (!runtimeId) return null;
  return getSclawEmbedBrowserRuntime(runtimeId);
}

export async function captureSclawEmbedBrowserPage(
  runtimeId: string,
): Promise<SclawEmbedBrowserPageSnapshot> {
  const entry = ensureRuntime(runtimeId);
  const wc = resolveWebContents(entry);
  const capturedAt = Date.now();

  if (!wc || wc.isDestroyed()) {
    return {
      pageUrl: entry.pageUrl,
      pageTitle: entry.pageTitle,
      visibleTextExcerpt: '',
      capturedAt,
    };
  }

  try {
    const result = await wc.executeJavaScript(PAGE_CAPTURE_SCRIPT) as {
      title?: string;
      url?: string;
      text?: string;
    } | null;

    const pageUrl = typeof result?.url === 'string' && result.url.trim()
      ? result.url.trim()
      : (wc.getURL() || entry.pageUrl);
    const pageTitle = typeof result?.title === 'string' ? result.title.trim() : entry.pageTitle;
    const visibleTextExcerpt = typeof result?.text === 'string' ? result.text.trim() : '';

    entry.pageUrl = pageUrl;
    entry.pageTitle = pageTitle;

    return { pageUrl, pageTitle, visibleTextExcerpt, capturedAt };
  } catch {
    return {
      pageUrl: wc.getURL() || entry.pageUrl,
      pageTitle: entry.pageTitle,
      visibleTextExcerpt: '',
      capturedAt,
    };
  }
}

export async function executeSclawEmbedBrowserScript(
  runtimeId: string,
  script: string,
): Promise<unknown> {
  const entry = ensureRuntime(runtimeId);
  const wc = resolveWebContents(entry);
  if (!wc || wc.isDestroyed()) {
    throw new Error('Embed browser webview is not ready');
  }
  return wc.executeJavaScript(script);
}

export function getSclawEmbedBrowserNetworkLog(
  runtimeId: string,
  since?: number,
): SclawEmbedBrowserNetworkEvent[] {
  const entry = runtimes.get(runtimeId);
  if (!entry) return [];
  if (!since) return [...entry.networkLog];
  return entry.networkLog.filter((event) => event.timestamp >= since);
}

/** Let pointer events pass through embed webview while resizing split pane. */
export function setSclawEmbedBrowserPointerPassthrough(runtimeId: string, passthrough: boolean): boolean {
  const entry = runtimes.get(runtimeId);
  if (!entry?.webContentsId) return false;
  const wc = resolveWebContents(entry);
  if (!wc) return false;
  // <webview> guest WebContents does not implement setIgnoreMouseEvents (BrowserWindow API only).
  if (typeof wc.setIgnoreMouseEvents !== 'function') return false;
  if (passthrough) {
    wc.setIgnoreMouseEvents(true, { forward: true });
  } else {
    wc.setIgnoreMouseEvents(false);
  }
  return true;
}
