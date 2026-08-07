import type { BrowserWindow } from 'electron';

import { CONNECTOR_PROGRESS_EVENT } from '../../shared/connectors/events';
import type { ConnectorConnectProgress } from '../../shared/connectors/types';

let lastProgress: ConnectorConnectProgress | null = null;

export function getLastConnectorProgress(connectorId?: string): ConnectorConnectProgress | null {
  if (!lastProgress) return null;
  if (connectorId && lastProgress.connectorId !== connectorId) return null;
  return lastProgress;
}

export function emitConnectorProgress(
  progress: ConnectorConnectProgress,
  windows?: Array<BrowserWindow | null | undefined>,
): void {
  lastProgress = progress;
  for (const win of windows ?? []) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(CONNECTOR_PROGRESS_EVENT, progress);
    } catch {
      // ignore destroyed windows
    }
  }
}

export function clearConnectorProgress(connectorId?: string): void {
  if (!lastProgress) return;
  if (connectorId && lastProgress.connectorId !== connectorId) return;
  lastProgress = null;
}
