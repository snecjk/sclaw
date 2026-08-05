/**
 * Parse managed_cli auth descriptor from catalog runtime.
 */
import { unwrapConnectorRuntime } from './normalize-runtime';
import type {
  ManagedCliAuthOpenIn,
  ManagedCliAuthSpec,
  ManagedCliAuthUi,
} from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseArgv(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const args = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return args.length > 0 ? args : undefined;
}

function parseLoginUrlPattern(raw: unknown): string | string[] | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const list = raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (list.length === 1) return list[0];
    if (list.length > 1) return list;
  }
  return undefined;
}

function parseUi(raw: string): ManagedCliAuthUi | undefined {
  if (raw === 'open_url' || raw === 'none' || raw === 'embedded') return raw;
  return undefined;
}

function parseOpenIn(raw: string): ManagedCliAuthOpenIn | undefined {
  if (raw === 'embedded' || raw === 'system') return raw;
  return undefined;
}

export function parseManagedCliAuthSpec(
  runtime: Record<string, unknown> | undefined | null,
): ManagedCliAuthSpec | null {
  const root = unwrapConnectorRuntime(runtime ?? {});
  const auth = asRecord(root.auth);
  const typeRaw = text(auth.type).toLowerCase();
  if (!typeRaw) return null;
  if (typeRaw !== 'cli_login' && typeRaw !== 'api_token') return null;
  const ui = parseUi(text(auth.ui).toLowerCase());
  const openIn = parseOpenIn(text(auth.openIn).toLowerCase());
  return {
    type: typeRaw as ManagedCliAuthSpec['type'],
    hint: text(auth.hint) || undefined,
    login: parseArgv(auth.login),
    loginWindows: parseArgv(auth.loginWindows),
    status: parseArgv(auth.status),
    logout: parseArgv(auth.logout),
    ui,
    openIn,
    loginUrlPattern: parseLoginUrlPattern(auth.loginUrlPattern),
    loggedInPattern: text(auth.loggedInPattern) || undefined,
    loggedOutPattern: text(auth.loggedOutPattern) || undefined,
    authExpiredPattern: text(auth.authExpiredPattern) || undefined,
    blockSystemOpen: auth.blockSystemOpen === true,
    adapter: text(auth.adapter) || undefined,
  };
}
