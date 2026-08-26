/**
 * Guest event names — keep in sync with shared/jsbridge/bridge-events.ts
 */
export const BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH = 'quote:preview-refresh' as const;
export const BRIDGE_EVENT_QUOTE_VALIDATION_COMPLETE = 'quote:validation-complete' as const;
export const BRIDGE_EVENT_QUOTE_SAVE_COMPLETE = 'quote:save-complete' as const;
export const BRIDGE_EVENT_QUOTE_SUBMIT_COMPLETE = 'quote:submit-complete' as const;
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

export interface QuoteSaveCompletePayload {
  ossKey: string;
  quoteId?: string;
  phase?: string;
  url?: string;
}

export interface QuoteSubmitCompletePayload {
  ossKey: string;
  quoteId?: string;
  detailUrl?: string;
  phase?: string;
  url?: string;
}
