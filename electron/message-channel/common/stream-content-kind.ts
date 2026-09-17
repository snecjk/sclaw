/**
 * Stream reply content semantics for Hub → App.
 * `type` remains delta/done (frame lifecycle); this tags what `content` means.
 * process placeholder → think; answer body → answer.
 * Missing field on wire is treated as answer.
 */
export type StreamContentKind = 'think' | 'tool' | 'answer';

/** Resolve kind for the content about to be pushed (same rules as delivery visibleContent). */
export function resolveStreamContentKind(input: {
  finalize: boolean;
  answer: string;
}): StreamContentKind {
  if (input.finalize) return 'answer';
  if (input.answer.trim()) return 'answer';
  return 'think';
}
