import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  emptyConnectorState,
  normalizeConnectorState,
} from '../../shared/connectors/state-schema';
import type {
  ConnectorLocalStateItem,
  ConnectorStateFile,
  ConnectorStatus,
} from '../../shared/connectors/types';

function stateDir(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

function statePath(): string {
  return join(stateDir(), 'state.json');
}

export function readConnectorState(): ConnectorStateFile {
  const path = statePath();
  if (!existsSync(path)) return emptyConnectorState();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return normalizeConnectorState(raw);
  } catch {
    return emptyConnectorState();
  }
}

export function writeConnectorState(state: ConnectorStateFile): void {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function getConnectorLocalItem(connectorId: string): ConnectorLocalStateItem | null {
  return readConnectorState().items[connectorId] ?? null;
}

export function upsertConnectorLocalItem(
  connectorId: string,
  patch: Partial<ConnectorLocalStateItem> & { status: ConnectorStatus },
): ConnectorLocalStateItem {
  const state = readConnectorState();
  const prev = state.items[connectorId];
  const next: ConnectorLocalStateItem = {
    status: patch.status,
    installedVersion:
      patch.installedVersion !== undefined
        ? patch.installedVersion
        : (prev?.installedVersion ?? null),
    lastError: patch.lastError !== undefined ? patch.lastError : (prev?.lastError ?? null),
    updatedAt: Date.now(),
    serverUrl: patch.serverUrl !== undefined ? patch.serverUrl : (prev?.serverUrl ?? null),
    tokenMask: patch.tokenMask !== undefined ? patch.tokenMask : (prev?.tokenMask ?? null),
  };
  state.items[connectorId] = next;
  writeConnectorState(state);
  return next;
}

export function listConnectedConnectorIds(): string[] {
  const state = readConnectorState();
  return Object.entries(state.items)
    .filter(([, item]) => item.status === 'connected')
    .map(([id]) => id);
}
