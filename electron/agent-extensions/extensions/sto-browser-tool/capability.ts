import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';

export type BrowserBridgeAction =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'navigate'
  | 'screenshot';

export interface BrowserBridgeSession {
  sessionId: string;
  tabId: number;
  url: string;
  title: string;
  source?: string;
  embedRuntimeId?: string;
}

export class StoBrowserBridgePortError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoBrowserBridgePortError';
    this.code = code;
  }
}

export interface StoBrowserBridgePort {
  listSessions(signal?: AbortSignal): Promise<BrowserBridgeSession[]>;
  ensureSession(signal?: AbortSignal, url?: string): Promise<string>;
  runCommand(input: {
    sessionId: string;
    action: BrowserBridgeAction;
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export const STO_BROWSER_BRIDGE_CAPABILITY =
  createSclawCapabilityToken<StoBrowserBridgePort>('sto.browser-bridge');
