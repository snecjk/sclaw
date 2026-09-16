/**
 * StoClaw Channel Hub（sto-wisdom-star）地址解析。
 */
export function resolveSclawHubBaseUrl(): string {
  const fromEnv = process.env.STO_SCLAW_HUB_BASE_URL
    || process.env.STO_WISDOM_STAR_BASE_URL
    || '';
  return fromEnv.replace(/\/+$/, '');
}

export function resolveSclawHubWsUrl(refreshToken: string): string {
  const base = resolveSclawHubBaseUrl();
  if (!base) {
    throw new Error('STO_SCLAW_HUB_BASE_URL (or STO_WISDOM_STAR_BASE_URL) is not configured');
  }
  const wsBase = base.replace(/^http/i, 'ws');
  const url = new URL('/ws/sclaw', `${wsBase}/`);
  url.searchParams.set('refreshToken', refreshToken);
  return url.toString();
}
