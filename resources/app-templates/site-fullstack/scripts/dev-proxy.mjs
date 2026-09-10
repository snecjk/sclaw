/**
 * Dev-proxy registry helpers (Node / Vite).
 * Absolute API hosts must be registered here; pages call `/proxy/<key>/...` only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEV_PROXY_CONTRACT_PATH = join(__dirname, '..', 'contracts', 'dev-proxy.v1.json');

export function proxyKeyFromHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function loadDevProxyFile(filePath = DEV_PROXY_CONTRACT_PATH) {
  if (!existsSync(filePath)) {
    return { version: 'v1', proxies: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      version: typeof raw.version === 'string' ? raw.version : 'v1',
      proxies: Array.isArray(raw.proxies) ? raw.proxies.filter(isProxyEntry) : [],
    };
  } catch {
    return { version: 'v1', proxies: [] };
  }
}

function isProxyEntry(item) {
  if (!item || typeof item !== 'object') return false;
  return typeof item.key === 'string' && item.key.trim() !== '' && typeof item.target === 'string' && item.target.trim() !== '';
}

/** Build Vite `server.proxy` from contracts/dev-proxy.v1.json */
export function buildViteProxyFromFile(filePath = DEV_PROXY_CONTRACT_PATH) {
  const file = loadDevProxyFile(filePath);
  /** @type {Record<string, { target: string, changeOrigin: boolean, rewrite: (path: string) => string }>} */
  const proxy = {};

  for (const entry of file.proxies) {
    const key = entry.key.trim();
    const target = entry.target.trim().replace(/\/$/, '');
    if (!key || !target) continue;
    const prefix = `/proxy/${key}`;
    proxy[prefix] = {
      target,
      changeOrigin: entry.changeOrigin !== false,
      rewrite: (path) => path.replace(new RegExp(`^${escapeRegExp(prefix)}`), '') || '/',
    };
  }
  return proxy;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Register absolute API URL into dev-proxy and return the relative path pages should call.
 * Idempotent: existing key/target is reused.
 */
export function ensureDevProxyForAbsoluteUrl(absoluteUrl, filePath = DEV_PROXY_CONTRACT_PATH) {
  const parsed = new URL(absoluteUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http(s) 接口地址: ${absoluteUrl}`);
  }

  const target = parsed.origin;
  const key = proxyKeyFromHostname(parsed.hostname);
  if (!key) throw new Error(`无法从主机名生成 proxy key: ${parsed.hostname}`);

  const file = loadDevProxyFile(filePath);
  const existing = file.proxies.find(
    (row) => row.key === key || row.target.replace(/\/$/, '') === target,
  );
  let added = false;

  if (!existing) {
    file.proxies.push({ key, target, changeOrigin: true });
    added = true;
    writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  } else if (existing.target.replace(/\/$/, '') !== target) {
    throw new Error(
      `proxy key「${existing.key}」已指向 ${existing.target}，与新地址 ${target} 冲突；请手工调整 contracts/dev-proxy.v1.json`,
    );
  }

  const resolvedKey = existing?.key ?? key;
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const relativeUrl = `/proxy/${resolvedKey}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
  const resolvedAbsoluteUrl = `${target}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;

  return {
    key: resolvedKey,
    target,
    /** DEV path for Vite proxy; also the canonical form stored in pages/action-registry */
    relativeUrl,
    /** PROD form: request.ts rewrites relativeUrl → absoluteUrl using this contract */
    absoluteUrl: resolvedAbsoluteUrl,
    added,
    filePath,
  };
}
