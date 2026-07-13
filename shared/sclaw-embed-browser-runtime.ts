/** Shared types for SClaw in-app embed browser runtime (chat ↔ webview binding). */

export interface SclawEmbedBrowserRuntimeMeta {
  runtimeId: string;
  chatSessionKey: string | null;
  appTitle: string;
  initialUrl: string;
  pageUrl: string;
  pageTitle: string;
  webContentsId: number | null;
  createdAt: number;
  boundAt: number | null;
}

export interface SclawEmbedBrowserNetworkEvent {
  method: string;
  url: string;
  statusCode?: number;
  resourceType?: string;
  timestamp: number;
}

export interface SclawEmbedBrowserPageSnapshot {
  pageUrl: string;
  pageTitle: string;
  visibleTextExcerpt: string;
  capturedAt: number;
}

export const SCLAW_EMBED_BROWSER_NETWORK_LOG_LIMIT = 200;

export const SCLAW_EMBED_BROWSER_VISIBLE_TEXT_LIMIT = 6000;
