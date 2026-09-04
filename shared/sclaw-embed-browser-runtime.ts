/** Shared types for SClaw in-app embed browser runtime (chat ↔ webview binding). */

export interface SclawEmbedBrowserRuntimeMeta {
  runtimeId: string;
  chatSessionKey: string | null;
  appTitle: string;
  initialUrl: string;
  pageUrl: string;
  pageTitle: string;
  webContentsId: number | null;
  /** App Plaza app id (sanitized session key). */
  appId: string | null;
  /** Catalog / My Apps tab — affects bridge trust tier. */
  bound: boolean;
  createdAt: number;
  boundAt: number | null;
  /**
   * D1 可见性上报（BAP assertPageActionable 的数据源）：
   * 渲染层 SclawBrowserFrame 按 active/生命周期上报；undefined = 未上报（按可见处理，灰度兼容）。
   */
  visible?: boolean;
  /** JSBridge session bootstrap when page is *.sto.cn. */
  bridgeBootstrap?: import('./jsbridge/protocol').BridgeBootstrap | null;
}

/** D1 可见性上报原因（渲染层 → 主进程）。 */
export type SclawEmbedBrowserVisibilityReason =
  | 'drawer-toggle'
  | 'tab-switch'
  | 'window-blur'
  | 'dom-ready';

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
