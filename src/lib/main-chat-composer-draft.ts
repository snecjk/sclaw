/**
 * Module-level mirror of the live main-chat composer text.
 *
 * The composer keeps its content in a contenteditable DOM tree, so features
 * outside the chat surface (learning center case actions, connector "去试试")
 * cannot read it directly. ChatInput publishes every snapshot here and clears
 * it on unmount, which makes an unmounted composer read as an empty draft —
 * the same thing the user sees when they come back to chat.
 */
export type MainChatDraftMode = 'REPLACE' | 'APPEND';

/** Separator used when appending to a non-empty draft. */
export const MAIN_CHAT_DRAFT_APPEND_SEPARATOR = '\n\n';

let currentDraft = '';

export function publishMainChatComposerDraft(text: string): void {
  currentDraft = typeof text === 'string' ? text : '';
}

export function clearMainChatComposerDraft(): void {
  currentDraft = '';
}

export function readMainChatComposerDraft(): string {
  return currentDraft;
}

/**
 * Merge incoming prompt text into the existing draft.
 * APPEND on an empty draft writes the prompt without a leading separator.
 */
export function mergeMainChatDraft(
  existing: string,
  incoming: string,
  mode: MainChatDraftMode,
): string {
  const next = incoming.trim();
  if (mode !== 'APPEND') return next;
  const base = existing.replace(/\s+$/, '');
  if (!base) return next;
  return `${base}${MAIN_CHAT_DRAFT_APPEND_SEPARATOR}${next}`;
}
