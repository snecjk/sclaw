#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/ensure-dev-proxy.mjs https://baseinfo-chatbotapi-test.sto.cn/api/robot/page
 *
 * Writes/updates contracts/dev-proxy.v1.json and prints JSON:
 *   { key, target, relativeUrl, absoluteUrl, added }
 *
 * Put `relativeUrl` (`/proxy/<key>/...`) into action-registry / pages.
 * DEV: Vite proxies it. PROD: request.ts rewrites to absoluteUrl via the contract.
 * Restart / refresh Vite after new domains.
 */
import { ensureDevProxyForAbsoluteUrl } from './dev-proxy.mjs';

const absoluteUrl = process.argv[2]?.trim();
if (!absoluteUrl) {
  console.error('Usage: node scripts/ensure-dev-proxy.mjs <absolute-http-url>');
  process.exit(1);
}

try {
  const result = ensureDevProxyForAbsoluteUrl(absoluteUrl);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
