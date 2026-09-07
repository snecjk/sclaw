export type BrowserBridgeAction =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'navigate'
  | 'screenshot'
  | 'evaluate'
  | 'scroll'
  | 'read_page'
  | 'print_pdf'
  | 'cdp'
  | 'group_tabs'
  | 'mark_tabs';

export type BrowserBridgeSessionSource = 'extension' | 'embed';

export type BrowserBridgeOwnership = 'owned' | 'borrowed';

export interface BrowserBridgeSession {
  sessionId: string;
  tabId: number;
  url: string;
  title: string;
  connectedAt: number;
  lastHeartbeat: number;
  token: string;
  source?: BrowserBridgeSessionSource;
  embedRuntimeId?: string;
  /** owned=应用创建可销毁；borrowed=用户已有 tab 只借不毁。 */
  ownership: BrowserBridgeOwnership;
  extensionVersion?: string;
  groupId?: string;
  taskLabel?: string;
}

export interface BrowserBridgeCommand {
  commandId: string;
  action: BrowserBridgeAction;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface BrowserBridgeCommandResult {
  commandId: string;
  sessionId: string;
  action: BrowserBridgeAction;
  result: unknown;
  completedAt: number;
}

export interface BrowserBridgeSnapshot {
  url: string;
  title: string;
  timestamp: number;
  elements: Array<{
    ref: string;
    role: string;
    name?: string;
    clickable?: boolean;
    editable?: boolean;
  }>;
  documentGeneration: number;
  observationMode: 'ax' | 'dom';
  truncated?: boolean;
}

export const BROWSER_BRIDGE_EMBED_TAB_ID = -1;
export const BROWSER_BRIDGE_EMBED_TOKEN = '__stoclaw_embed__';
export const BROWSER_BRIDGE_COMMAND_TTL_MS = 30 * 1000;
export const BROWSER_BRIDGE_SESSION_STALE_MS = 60 * 1000;
export const BROWSER_BRIDGE_POLL_WAIT_MAX_MS = 25 * 1000;
export const BROWSER_BRIDGE_CONSENT_TIMEOUT_MS = 90 * 1000;
export const BROWSER_BRIDGE_ATTACH_TIMEOUT_MS = 25 * 1000;
export const BROWSER_BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const BROWSER_BRIDGE_DEFAULT_PORT = 3210;

export type BrowserBridgeChromeConsent = 'unknown' | 'allowed' | 'denied';

export interface BrowserBridgeControlCommand {
  commandId: string;
  action: 'attach';
  url?: string;
  createdAt: number;
  expiresAt: number;
}
