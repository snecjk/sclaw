/** ISO-8601 datetime without timezone suffix (API often returns UTC without `Z`). */
const ISO_WITHOUT_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/**
 * Normalize workflow API timestamps for consistent parsing.
 * Treats timezone-less ISO strings as UTC to match `...Z` fields from the same API.
 */
export function normalizeWorkflowTimestamp(value: string): string {
  const trimmed = value.trim();
  if (ISO_WITHOUT_TZ.test(trimmed)) {
    return `${trimmed}Z`;
  }
  return trimmed;
}

export function parseWorkflowTimestampMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(normalizeWorkflowTimestamp(value));
  return Number.isFinite(ms) ? ms : null;
}
