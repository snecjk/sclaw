/**
 * Time utilities for China Standard Time (CST, UTC+8) formatting.
 */

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Format a Date as ISO 8601 string in China Standard Time (UTC+8).
 * Output example: "2026-04-20T16:30:00.000+08:00"
 */
export function toCSTISOString(date: Date): string {
  const cstTime = new Date(date.getTime() + CST_OFFSET_MS);
  const iso = cstTime.toISOString(); // e.g. "2026-04-20T08:30:00.000Z"
  // Replace trailing "Z" with "+08:00"
  return iso.slice(0, -1) + '+08:00';
}
