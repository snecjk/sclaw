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

export function formatShanghaiIso(value: Date | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return [
    shanghai.getUTCFullYear(),
    '-',
    pad(shanghai.getUTCMonth() + 1),
    '-',
    pad(shanghai.getUTCDate()),
    'T',
    pad(shanghai.getUTCHours()),
    ':',
    pad(shanghai.getUTCMinutes()),
    ':',
    pad(shanghai.getUTCSeconds()),
    '.',
    pad(shanghai.getUTCMilliseconds(), 3),
    '+08:00',
  ].join('');
}
