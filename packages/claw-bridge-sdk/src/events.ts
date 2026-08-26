/**
 * Guest event names — keep in sync with shared/jsbridge/bridge-events.ts
 */
export const BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH = 'quote:preview-refresh' as const;
export const BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE = 'quote:validation-complete' as const;
export const BRIDGE_EVENT_SESSION_DESTROYED = 'bridge:session-destroyed' as const;

export type BridgeSubscribeResult = {
  subscribed: string[];
  added?: string[];
  denied?: string[];
};

export interface QuotePreviewRefreshPayload {
  ossKey: string;
  phase?: string;
  mode?: 'open' | 'refresh';
  url?: string;
}

export interface QuoteValidationCompletePayload {
  ossKey: string;
  pass: boolean;
  errorCount?: number;
  phase?: string;
}
