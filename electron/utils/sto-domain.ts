/**
 * Shared STO domain resolution utility.
 * Maps the current SSO environment to the corresponding STO backend base URL.
 */
import { getSsoEnvironment } from './auth-store';

const STO_DOMAINS: Record<string, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn',
  'local': 'http://127.0.0.1:7001',
};
const STO_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn';

export async function resolveStoBaseUrl(): Promise<string> {
  const override = process.env.STO_MEMORY_CENTER_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/+$/, '');
  }
  const env = await getSsoEnvironment();
  return STO_DOMAINS[env] || STO_DOMAIN_DEFAULT;
}
