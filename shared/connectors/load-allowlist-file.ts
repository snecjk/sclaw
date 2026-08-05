/**
 * Read ~/.stoclaw/connectors/gateway-allowlist.json (Gateway plugin + preload).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConnectorAllowlistEntry } from './bash-gate';

let cachedEntries: ConnectorAllowlistEntry[] | null = null;
let cachedMtime = -1;

function connectorsDir(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

export function getGatewayAllowlistFilePath(): string {
  return join(connectorsDir(), 'gateway-allowlist.json');
}

export function loadConnectorAllowlistFromFile(): ConnectorAllowlistEntry[] {
  try {
    const file = getGatewayAllowlistFilePath();
    if (!existsSync(file)) {
      cachedEntries = [];
      cachedMtime = -1;
      return cachedEntries;
    }
    const mtime = statSync(file).mtimeMs;
    if (cachedEntries && mtime === cachedMtime) return cachedEntries;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { entries?: ConnectorAllowlistEntry[] };
    cachedEntries = Array.isArray(raw.entries) ? raw.entries : [];
    cachedMtime = mtime;
    return cachedEntries;
  } catch {
    return cachedEntries ?? [];
  }
}

/** Test helper — reset in-memory cache between cases. */
export function resetConnectorAllowlistFileCache(): void {
  cachedEntries = null;
  cachedMtime = -1;
}
