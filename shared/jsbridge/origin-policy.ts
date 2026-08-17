import { JSBRIDGE_ORIGIN_POLICY } from './config';

function parseOrigin(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/** True when hostname is sto.cn or a subdomain of sto.cn. */
export function isStoCnHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (JSBRIDGE_ORIGIN_POLICY.allowRootDomain && host === 'sto.cn') return true;
  return host.endsWith('.sto.cn');
}

/** True when origin URL is under *.sto.cn (http/https). */
export function isStoCnOrigin(originOrUrl: string): boolean {
  const parsed = parseOrigin(originOrUrl);
  if (!parsed) return false;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return isStoCnHostname(parsed.hostname);
}

export function originFromUrl(url: string): string | null {
  const parsed = parseOrigin(url);
  return parsed ? parsed.origin : null;
}

/** Match origin against patterns like https://*.sto.cn or exact https://policy.sto.cn */
export function matchOriginPattern(pattern: string, origin: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  if (!trimmed.includes('*')) {
    return trimmed === origin;
  }

  const parsedPattern = parseOrigin(trimmed.replace('*.', 'placeholder.'));
  const parsedOrigin = parseOrigin(origin);
  if (!parsedPattern || !parsedOrigin) return false;
  if (parsedPattern.protocol !== parsedOrigin.protocol) return false;

  const suffix = trimmed.includes('://*.')
    ? trimmed.split('://*.')[1]
    : trimmed.replace(/^\*\./, '');

  if (!suffix) return isStoCnOrigin(origin);

  const host = parsedOrigin.hostname.toLowerCase();
  const suffixLower = suffix.toLowerCase();
  return host === suffixLower || host.endsWith(`.${suffixLower}`);
}

export function matchAnyOriginPattern(patterns: readonly string[], origin: string): boolean {
  if (patterns.length === 0) {
    return isStoCnOrigin(origin);
  }
  return patterns.some((pattern) => matchOriginPattern(pattern, origin));
}

/** Validate app-specific patterns — must all be sto.cn subsets. */
export function normalizeAppAllowedOrigins(patterns: string[] | undefined): string[] {
  if (!patterns?.length) {
    return [...JSBRIDGE_ORIGIN_POLICY.globalPatterns];
  }
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const sample = pattern.replace('*.', 'example.');
      if (!isStoCnOrigin(sample.startsWith('http') ? sample : `https://${sample}`)) {
        throw new Error(`Invalid bridge origin pattern (non-sto.cn): ${pattern}`);
      }
      continue;
    }
    const sampleOrigin = pattern.includes('://') ? pattern : `https://${pattern}`;
    if (!isStoCnOrigin(sampleOrigin)) {
      throw new Error(`Invalid bridge origin pattern (non-sto.cn): ${pattern}`);
    }
  }
  return patterns;
}

export function assertStoCnPageUrl(pageUrl: string): void {
  const origin = originFromUrl(pageUrl);
  if (!origin || !isStoCnOrigin(origin)) {
    throw new Error(`Bridge origin denied: only *.sto.cn is allowed (${pageUrl})`);
  }
}
