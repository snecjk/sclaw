/**
 * Shared chat configuration constants.
 * Used by both renderer (src) and main (electron) processes.
 */

/** Page size for paginated session history loading (Gateway default ~50). */
export const CHAT_HISTORY_LIMIT = 50;

/** Gateway hard cap for chat.history message length per session (1e3 = 1000). */
export const CHAT_HISTORY_LENGTH_MAX_LIMIT = 1e3;
