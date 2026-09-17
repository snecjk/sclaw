/**
 * Local equivalent of `openclaw/plugin-sdk/account-id#normalizeAccountId`.
 * Phase 0 thin-transport shim — no openclaw runtime import.
 */

const DEFAULT_ACCOUNT_ID = "default";
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);

const cache = new Map<string, string>();

function canonicalize(value: string): string {
  if (VALID_ID_RE.test(value)) return value.toLowerCase();
  return value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "")
    .slice(0, 64);
}

export function normalizeAccountId(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_ACCOUNT_ID;
  const hit = cache.get(trimmed);
  if (hit) return hit;
  const canonical = canonicalize(trimmed);
  const normalized = !canonical || BLOCKED.has(canonical) ? DEFAULT_ACCOUNT_ID : canonical;
  cache.set(trimmed, normalized);
  if (cache.size > 256) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return normalized;
}

export { DEFAULT_ACCOUNT_ID };
