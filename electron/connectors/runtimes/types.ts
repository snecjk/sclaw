import type { BrowserWindow } from 'electron';

import type {
  ConnectorConnectPhase,
  ConnectorDescriptor,
  ConnectorStatus,
} from '../../../shared/connectors/types';

export interface KindRuntimeTokenCredentials {
  serverUrl: string;
  token: string;
}

export interface KindRuntimeConnectContext {
  descriptor: ConnectorDescriptor;
  parentWindow?: BrowserWindow | null;
  onProgress?: (phase: ConnectorConnectPhase, message: string) => void;
  /** Required by api_token kind when connecting via /token-connect. */
  credentials?: KindRuntimeTokenCredentials;
}

export interface KindRuntimeConnectResult {
  status: Extract<ConnectorStatus, 'connected' | 'installed' | 'error'>;
  installedVersion?: string | null;
  error?: string;
}

export interface KindRuntimeStatusResult {
  status: ConnectorStatus;
  installedVersion?: string | null;
  authenticated?: boolean;
  error?: string;
}

export interface KindRuntime {
  readonly kind: string;
  connect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeConnectResult>;
  disconnect(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult>;
  probe(ctx: KindRuntimeConnectContext): Promise<KindRuntimeStatusResult>;
}
