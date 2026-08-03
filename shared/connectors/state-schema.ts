import type { ConnectorLocalStateItem, ConnectorStateFile, ConnectorStatus } from './types';

export const CONNECTOR_STATE_VERSION = 1 as const;

export function emptyConnectorState(): ConnectorStateFile {
  return { version: CONNECTOR_STATE_VERSION, items: {} };
}

export function isConnectorStatus(value: unknown): value is ConnectorStatus {
  return (
    value === 'available' ||
    value === 'installing' ||
    value === 'authorizing' ||
    value === 'installed' ||
    value === 'connected' ||
    value === 'error'
  );
}

export function normalizeConnectorState(raw: unknown): ConnectorStateFile {
  if (!raw || typeof raw !== 'object') return emptyConnectorState();
  const record = raw as Record<string, unknown>;
  const itemsRaw = record.items;
  if (!itemsRaw || typeof itemsRaw !== 'object') return emptyConnectorState();

  const items: Record<string, ConnectorLocalStateItem> = {};
  for (const [id, value] of Object.entries(itemsRaw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    if (!isConnectorStatus(row.status)) continue;
    items[id] = {
      status: row.status,
      installedVersion: typeof row.installedVersion === 'string' ? row.installedVersion : null,
      lastError: typeof row.lastError === 'string' ? row.lastError : null,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
      serverUrl: typeof row.serverUrl === 'string' ? row.serverUrl : null,
      tokenMask: typeof row.tokenMask === 'string' ? row.tokenMask : null,
    };
  }
  return { version: CONNECTOR_STATE_VERSION, items };
}
