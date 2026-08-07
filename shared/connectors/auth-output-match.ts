/**
 * Match CLI auth stdout/stderr against server-provided patterns.
 */
export function compileAuthPattern(pattern: string | undefined | null): RegExp | null {
  const raw = typeof pattern === 'string' ? pattern.trim() : '';
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch {
    return null;
  }
}

export function normalizeLoginUrlPatterns(
  value: string | string[] | undefined | null,
): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/** Extract first login URL from text using one or more RegExp source patterns. */
export function extractLoginUrlFromOutput(
  text: string,
  patterns: string | string[] | undefined | null,
): string | null {
  if (!text) return null;
  for (const source of normalizeLoginUrlPatterns(patterns)) {
    const re = compileAuthPattern(source);
    if (!re) continue;
    const match = text.match(re);
    if (match?.[0]) {
      return match[0].replace(/[.,;:]+$/, '').trim();
    }
  }
  return null;
}

export function matchAuthExpired(
  message: string,
  pattern: string | undefined | null,
): boolean {
  const re = compileAuthPattern(pattern);
  if (!re) return false;
  return re.test(message.trim());
}

/**
 * Interpret auth.status output.
 * - loggedOutPattern wins when matched
 * - else loggedInPattern
 * - else fall back to exitCode === 0
 */
export function interpretAuthStatusWithPatterns(options: {
  stdout: string;
  stderr: string;
  exitCode: number;
  loggedInPattern?: string;
  loggedOutPattern?: string;
}): boolean {
  const text = `${options.stdout}\n${options.stderr}`.trim();
  const loggedOut = compileAuthPattern(options.loggedOutPattern);
  if (loggedOut && loggedOut.test(text)) return false;
  const loggedIn = compileAuthPattern(options.loggedInPattern);
  if (loggedIn && loggedIn.test(text)) return true;
  return options.exitCode === 0;
}
