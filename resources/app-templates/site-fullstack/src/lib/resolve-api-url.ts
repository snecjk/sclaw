/**
 * Resolve app API URLs across environments.
 *
 * Canonical form in pages / action-registry: `/proxy/<key>/...`
 * - DEV: keep as-is (Vite `server.proxy` forwards to target)
 * - PROD: rewrite to `${target}${path}` using contracts/dev-proxy.v1.json
 *   so `/proxy` never hits the static publish host.
 */
export type DevProxyEntry = {
  key: string;
  target: string;
  changeOrigin?: boolean;
};

export type DevProxyContract = {
  version?: string;
  proxies?: DevProxyEntry[];
};

const PROXY_PATH_RE = /^\/proxy\/([^/?#]+)(.*)$/;

export function resolveApiUrl(
  url: string,
  options: {
    isDev?: boolean;
    proxies?: DevProxyEntry[];
  } = {},
): string {
  const trimmed = String(url || '').trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const isDev = options.isDev ?? (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV));
  if (isDev) return trimmed;

  const match = trimmed.match(PROXY_PATH_RE);
  if (!match) return trimmed;

  const key = match[1] ?? '';
  const rest = match[2] && match[2].length > 0 ? match[2] : '/';
  const entry = (options.proxies ?? []).find((row) => row.key === key);
  if (!entry?.target) {
    // eslint-disable-next-line no-console -- help diagnose missing proxy contract in prod builds
    console.error(
      `[sclaw-app-request] 生产环境无法解析 /proxy/${key}：请在 contracts/dev-proxy.v1.json 登记 target`,
    );
    return trimmed;
  }
  return `${entry.target.replace(/\/$/, '')}${rest}`;
}

export function proxiesFromContract(contract: DevProxyContract | null | undefined): DevProxyEntry[] {
  if (!contract || !Array.isArray(contract.proxies)) return [];
  return contract.proxies.filter(
    (row): row is DevProxyEntry =>
      Boolean(row)
      && typeof row.key === 'string'
      && row.key.trim() !== ''
      && typeof row.target === 'string'
      && row.target.trim() !== '',
  );
}
