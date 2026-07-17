export type BrowserBridgeAction =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'navigate'
  | 'screenshot'
  | 'evaluate'
  | 'scroll';

export type BrowserBridgeSessionSource = 'extension' | 'embed';

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
  tree: unknown[];
}

export const BROWSER_BRIDGE_EMBED_TAB_ID = -1;
export const BROWSER_BRIDGE_EMBED_TOKEN = '__stoclaw_embed__';
export const BROWSER_BRIDGE_COMMAND_TTL_MS = 30 * 1000;
export const BROWSER_BRIDGE_SESSION_STALE_MS = 60 * 1000;
export const BROWSER_BRIDGE_DEFAULT_HOST = '127.0.0.1';
export const BROWSER_BRIDGE_DEFAULT_PORT = 3210;
