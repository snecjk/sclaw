const PI_SESSION_TOO_SMALL_MARKERS = [
  'nothing to compact',
  'session too small',
] as const;

/** Recognize Pi's deterministic no-op response without exposing SDK wording to users. */
export function isSessionTooSmallToCompact(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return PI_SESSION_TOO_SMALL_MARKERS.every((marker) => normalized.includes(marker));
}
