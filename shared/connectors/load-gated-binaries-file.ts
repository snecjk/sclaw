/**
 * Read ~/.stoclaw/connectors/gateway-gated-binaries.json (bash gate + preload).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  LEGACY_CONNECTOR_GATED_BINARIES,
  resolveGatedBinaries,
} from './collect-gated-binaries';

let cachedBinaries: string[] | null = null;
let cachedMtime = -1;

function connectorsDir(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

export function getGatewayGatedBinariesFilePath(): string {
  return join(connectorsDir(), 'gateway-gated-binaries.json');
}

export function loadConnectorGatedBinariesFromFile(): string[] {
  try {
    const file = getGatewayGatedBinariesFilePath();
    if (!existsSync(file)) {
      cachedBinaries = [...LEGACY_CONNECTOR_GATED_BINARIES];
      cachedMtime = -1;
      return cachedBinaries;
    }
    const mtime = statSync(file).mtimeMs;
    if (cachedBinaries && mtime === cachedMtime) return cachedBinaries;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { binaries?: string[] };
    const listed = Array.isArray(raw.binaries) ? raw.binaries : [];
    cachedBinaries = resolveGatedBinaries(listed);
    cachedMtime = mtime;
    return cachedBinaries;
  } catch {
    return cachedBinaries ?? [...LEGACY_CONNECTOR_GATED_BINARIES];
  }
}

/** Test helper — reset in-memory cache between cases. */
export function resetConnectorGatedBinariesFileCache(): void {
  cachedBinaries = null;
  cachedMtime = -1;
}
