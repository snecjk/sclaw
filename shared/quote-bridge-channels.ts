/**
 * Quote workbench — `quote:event` payload channels (domain layer, not JSBridge).
 */

/** Host opened / re-opened business page (ossKey / previewUrl). */
export const QUOTE_BRIDGE_CHANNEL_PREVIEW_OPEN = 'preview.open' as const;

/** `vip quotation save` succeeded — business semantics: submit quote (upload or batch adjust). */
export const QUOTE_BRIDGE_CHANNEL_SAVE_COMPLETE = 'save.complete' as const;

/** Batch adjust: NL parsed to CLI `objectListJson`. */
export const QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_PARAMS_READY = 'batch-adjust.params-ready' as const;

/** Batch adjust: parameter validate failed (pass=true 不通知). */
export const QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_VALIDATE_FAIL = 'batch-adjust.validate-fail' as const;

/** Batch adjust: draft created via `quotation-draft create`. */
export const QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_DRAFT_COMPLETE = 'batch-adjust.draft-complete' as const;

export const QUOTE_BRIDGE_CHANNELS = {
  PREVIEW_OPEN: QUOTE_BRIDGE_CHANNEL_PREVIEW_OPEN,
  SAVE_COMPLETE: QUOTE_BRIDGE_CHANNEL_SAVE_COMPLETE,
  BATCH_ADJUST_PARAMS_READY: QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_PARAMS_READY,
  BATCH_ADJUST_VALIDATE_FAIL: QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_VALIDATE_FAIL,
  BATCH_ADJUST_DRAFT_COMPLETE: QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_DRAFT_COMPLETE,
} as const;

export type QuoteBridgeChannel = typeof QUOTE_BRIDGE_CHANNELS[keyof typeof QUOTE_BRIDGE_CHANNELS] | (string & {});

export interface QuoteBridgeEventPayload {
  channel: string;
  cardId?: string;
  phase?: string;
  url?: string | null;
  [key: string]: unknown;
}

export type QuoteBridgeNotifyKind =
  | 'preview'
  | 'save'
  | 'batch-adjust-params'
  | 'batch-adjust-validate-fail'
  | 'batch-adjust-draft';
