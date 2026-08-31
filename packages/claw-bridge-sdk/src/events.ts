/**
 * JSBridge lifecycle event names only — domain channels live in business docs / skill.
 */
export const BRIDGE_EVENT_QUOTE = 'quote:event' as const;
export const BRIDGE_EVENT_SESSION_DESTROYED = 'bridge:session-destroyed' as const;

export type BridgeSubscribeResult = {
  subscribed: string[];
  added?: string[];
  denied?: string[];
};

/** Payload for `quote:event` — use `channel` to distinguish business scenarios. */
export interface QuoteBridgeEventPayload {
  channel: string;
  cardId?: string;
  phase?: string;
  url?: string | null;
  [key: string]: unknown;
}
