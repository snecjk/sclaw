/**
 * ConnectorService — one-click connect orchestration + local state authority.
 */
import type { BrowserWindow } from 'electron';

import { resolveManagedCliBinary, unwrapConnectorRuntime } from '../../shared/connectors/normalize-runtime';
import { resolveEffectiveConnector } from '../../shared/connectors/resolve-effective-runtime';
import type {
  ConnectorConnectProgress,
  ConnectorDescriptor,
  ConnectorStatus,
  ConnectorViewItem,
} from '../../shared/connectors/types';
import { fetchConnectorCatalog } from './catalog-client';
import {
  persistConnectedConnectorsAgentPrompt,
  resolveConnectedGitlabHostname,
} from './agent-context';
import { ConnectorError, ConnectorErrorCode } from './errors';
import {
  rebuildGatewayAllowlist,
  setConnectorCatalog,
} from './gateway-allowlist';
import {
  projectConnectorSkillFromCache,
  rebuildConnectorSkillProjections,
  unpublishConnectorSkill,
} from './connector-skill-sync';
import { connectorSkillSlug } from '../../shared/connectors/resolve-agent-skill';
import {
  clearConnectorProgress,
  emitConnectorProgress,
  getLastConnectorProgress,
} from './progress';
import { getKindRuntime } from './runtimes/registry';
import {
  getConnectorLocalItem,
  readConnectorState,
  upsertConnectorLocalItem,
} from './state-store';
import { maskToken } from './credential-store';
import { glabSetDefaultHost } from '../utils/glab-cli';
import { logger } from '../utils/logger';

const busyConnectors = new Set<string>();
let cachedCatalog: ConnectorDescriptor[] = [];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Rebuild gateway allowlist + connector-index + skill projections. */
function rebuildConnectorRuntime(): void {
  rebuildGatewayAllowlist();
  try {
    rebuildConnectorSkillProjections(cachedCatalog);
  } catch (error) {
    logger.warn(
      '[connectors] rebuild skill projections failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    persistConnectedConnectorsAgentPrompt();
  } catch (error) {
    logger.warn(
      '[connectors] persist agent context failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
  const gitlabHost = resolveConnectedGitlabHostname();
  if (gitlabHost) {
    void glabSetDefaultHost(gitlabHost).then((result) => {
      if (!result.ok) {
        logger.warn('[connectors] set glab default host failed:', result.error || result.stderr);
      }
    });
  }
}

/** @deprecated use rebuildConnectorRuntime */
function syncConnectorGatewayArtifacts(): void {
  rebuildConnectorRuntime();
}

/** Token form required for api_token kind or managed_cli binaries like glab. */
export function requiresTokenCredentials(descriptor: ConnectorDescriptor): boolean {
  const effective = resolveEffectiveConnector(descriptor);
  if (effective.isGlab) return true;
  if (descriptor.kind === 'api_token') return true;
  if (descriptor.kind !== 'managed_cli' && descriptor.kind !== 'managed-cli') return false;
  const runtime = unwrapConnectorRuntime(asRecord(descriptor.runtime));
  const binary = resolveManagedCliBinary(runtime, {
    connectorId: descriptor.id,
    kind: descriptor.kind,
  });
  const authType = text(asRecord(runtime.auth).type).toLowerCase();
  return binary === 'glab' || authType === 'api_token' || authType === 'token';
}

function mergeViewItem(descriptor: ConnectorDescriptor): ConnectorViewItem {
  const local = getConnectorLocalItem(descriptor.id);
  return {
    ...descriptor,
    localStatus: local?.status ?? 'available',
    lastError: local?.lastError ?? null,
    installedVersion: local?.installedVersion ?? null,
  };
}

function resolveRuntimeOrThrow(descriptor: ConnectorDescriptor) {
  const effective = resolveEffectiveConnector(descriptor);
  const runtime = getKindRuntime(effective.kind);
  if (!runtime) {
    throw new ConnectorError(
      ConnectorErrorCode.UNKNOWN_KIND,
      `不支持的连接类型 ${descriptor.kind}，请升级客户端`,
    );
  }
  return { effective, runtime };
}

export class ConnectorService {
  async refreshCatalog(): Promise<ConnectorDescriptor[]> {
    const catalog = await fetchConnectorCatalog();
    cachedCatalog = catalog;
    setConnectorCatalog(catalog);
    try {
      persistConnectedConnectorsAgentPrompt();
    } catch (error) {
      logger.warn(
        '[connectors] persist agent context failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return catalog;
  }

  getCachedCatalog(): ConnectorDescriptor[] {
    return cachedCatalog.slice();
  }

  async list(options?: { refresh?: boolean }): Promise<ConnectorViewItem[]> {
    if (options?.refresh !== false || cachedCatalog.length === 0) {
      try {
        await this.refreshCatalog();
      } catch (error) {
        logger.warn(
          '[connectors] catalog refresh failed:',
          error instanceof Error ? error.message : String(error),
        );
        if (cachedCatalog.length === 0) throw error;
      }
    }
    return cachedCatalog.map(mergeViewItem);
  }

  async get(connectorId: string): Promise<ConnectorViewItem | null> {
    const items = await this.list({ refresh: cachedCatalog.length === 0 });
    return items.find((item) => item.id === connectorId) ?? null;
  }

  getProgress(connectorId: string): ConnectorConnectProgress | null {
    return getLastConnectorProgress(connectorId);
  }

  async connect(
    connectorId: string,
    parentWindow?: BrowserWindow | null,
  ): Promise<ConnectorViewItem> {
    return this.runConnect(connectorId, parentWindow);
  }

  async tokenConnect(
    connectorId: string,
    credentials: { serverUrl: string; token: string },
    parentWindow?: BrowserWindow | null,
  ): Promise<ConnectorViewItem> {
    return this.runConnect(connectorId, parentWindow, credentials);
  }

  private async runConnect(
    connectorId: string,
    parentWindow?: BrowserWindow | null,
    credentials?: { serverUrl: string; token: string },
  ): Promise<ConnectorViewItem> {
    if (busyConnectors.has(connectorId)) {
      throw new ConnectorError(ConnectorErrorCode.BUSY, '连接进行中，请稍候');
    }

    if (cachedCatalog.length === 0) {
      await this.refreshCatalog();
    }
    const descriptor = cachedCatalog.find((item) => item.id === connectorId);
    if (!descriptor) {
      throw new ConnectorError(ConnectorErrorCode.NOT_FOUND, `未找到连接器：${connectorId}`);
    }

    const { effective, runtime: effectiveRuntime } = resolveRuntimeOrThrow(descriptor);

    if (requiresTokenCredentials(descriptor) && !credentials) {
      throw new ConnectorError(
        ConnectorErrorCode.AUTH_FAILED,
        '请通过 Token 表单连接该连接器',
      );
    }

    busyConnectors.add(connectorId);
    upsertConnectorLocalItem(connectorId, {
      status: credentials ? 'authorizing' : 'installing',
      lastError: null,
    });

    const windows = parentWindow ? [parentWindow] : [];
    const onProgress = (phase: 'installing' | 'authorizing', message: string) => {
      const status: ConnectorStatus = phase === 'installing' ? 'installing' : 'authorizing';
      upsertConnectorLocalItem(connectorId, { status, lastError: null });
      emitConnectorProgress({ connectorId, phase, message }, windows);
    };

    try {
      const result = await effectiveRuntime.connect({
        descriptor: effective.descriptor,
        parentWindow,
        onProgress,
        credentials,
      });
      if (result.status === 'connected') {
        upsertConnectorLocalItem(connectorId, {
          status: 'connected',
          installedVersion: result.installedVersion ?? null,
          lastError: null,
          serverUrl: credentials?.serverUrl?.trim().replace(/\/+$/, '') ?? null,
          tokenMask: credentials?.token ? maskToken(credentials.token) : null,
        });
        const skillSlug = connectorSkillSlug(descriptor);
        if (skillSlug) {
          projectConnectorSkillFromCache(skillSlug);
        }
      } else if (result.status === 'installed') {
        upsertConnectorLocalItem(connectorId, {
          status: 'installed',
          installedVersion: result.installedVersion ?? null,
          lastError: null,
        });
      } else {
        const message = result.error || '连接失败';
        upsertConnectorLocalItem(connectorId, {
          status: 'error',
          lastError: message,
        });
        syncConnectorGatewayArtifacts();
        clearConnectorProgress(connectorId);
        throw new ConnectorError(ConnectorErrorCode.AUTH_FAILED, message);
      }
      syncConnectorGatewayArtifacts();
      clearConnectorProgress(connectorId);
      return mergeViewItem(descriptor);
    } catch (error) {
      if (error instanceof ConnectorError && error.code === ConnectorErrorCode.AUTH_CANCELLED) {
        try {
          const probed = await effectiveRuntime.probe({ descriptor: effective.descriptor });
          upsertConnectorLocalItem(connectorId, {
            status: probed.status,
            installedVersion: probed.installedVersion ?? null,
            lastError: null,
          });
        } catch {
          upsertConnectorLocalItem(connectorId, {
            status: 'available',
            lastError: null,
          });
        }
        syncConnectorGatewayArtifacts();
        clearConnectorProgress(connectorId);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      upsertConnectorLocalItem(connectorId, { status: 'error', lastError: message });
      syncConnectorGatewayArtifacts();
      clearConnectorProgress(connectorId);
      throw error;
    } finally {
      busyConnectors.delete(connectorId);
    }
  }

  async disconnect(connectorId: string): Promise<ConnectorViewItem> {
    if (cachedCatalog.length === 0) {
      await this.refreshCatalog();
    }
    const descriptor = cachedCatalog.find((item) => item.id === connectorId);
    if (!descriptor) {
      throw new ConnectorError(ConnectorErrorCode.NOT_FOUND, `未找到连接器：${connectorId}`);
    }
    let effectiveRuntime;
    let effectiveDescriptor = descriptor;
    try {
      const resolved = resolveRuntimeOrThrow(descriptor);
      effectiveRuntime = resolved.runtime;
      effectiveDescriptor = resolved.effective.descriptor;
    } catch {
      upsertConnectorLocalItem(connectorId, {
        status: 'available',
        lastError: null,
        serverUrl: null,
        tokenMask: null,
      });
      syncConnectorGatewayArtifacts();
      return mergeViewItem(descriptor);
    }

    const result = await effectiveRuntime.disconnect({ descriptor: effectiveDescriptor });
    unpublishConnectorSkill(descriptor);
    upsertConnectorLocalItem(connectorId, {
      status: result.status === 'connected' ? 'installed' : result.status,
      installedVersion: result.installedVersion ?? null,
      lastError: null,
      serverUrl: null,
      tokenMask: null,
    });
    syncConnectorGatewayArtifacts();
    return mergeViewItem(descriptor);
  }

  async refreshStatus(connectorId: string): Promise<ConnectorViewItem> {
    if (cachedCatalog.length === 0) {
      await this.refreshCatalog();
    }
    const descriptor = cachedCatalog.find((item) => item.id === connectorId);
    if (!descriptor) {
      throw new ConnectorError(ConnectorErrorCode.NOT_FOUND, `未找到连接器：${connectorId}`);
    }
    let effectiveRuntime;
    let effectiveDescriptor = descriptor;
    try {
      const resolved = resolveRuntimeOrThrow(descriptor);
      effectiveRuntime = resolved.runtime;
      effectiveDescriptor = resolved.effective.descriptor;
    } catch {
      return mergeViewItem(descriptor);
    }
    const result = await effectiveRuntime.probe({ descriptor: effectiveDescriptor });
    upsertConnectorLocalItem(connectorId, {
      status: result.status,
      installedVersion: result.installedVersion ?? null,
      lastError: result.error ?? null,
    });
    syncConnectorGatewayArtifacts();
    return mergeViewItem(descriptor);
  }

  /** Best-effort: sync installed+auth connectors into connected for allowlist. */
  async syncProbes(): Promise<void> {
    try {
      await this.refreshCatalog();
    } catch (error) {
      logger.warn(
        '[connectors] syncProbes catalog failed:',
        error instanceof Error ? error.message : String(error),
      );
      // Still rebuild from existing local state + empty/partial catalog.
      syncConnectorGatewayArtifacts();
      return;
    }

    for (const descriptor of cachedCatalog) {
      let effectiveRuntime;
      let effectiveDescriptor = descriptor;
      try {
        const resolved = resolveRuntimeOrThrow(descriptor);
        effectiveRuntime = resolved.runtime;
        effectiveDescriptor = resolved.effective.descriptor;
      } catch {
        continue;
      }
      try {
        const result = await effectiveRuntime.probe({ descriptor: effectiveDescriptor });
        const prev = getConnectorLocalItem(descriptor.id);
        // Don't overwrite in-flight installing/authorizing.
        if (prev?.status === 'installing' || prev?.status === 'authorizing') continue;
        upsertConnectorLocalItem(descriptor.id, {
          status: result.status,
          installedVersion: result.installedVersion ?? null,
          lastError: result.error ?? null,
        });
      } catch (error) {
        logger.warn(
          `[connectors] probe ${descriptor.id} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    syncConnectorGatewayArtifacts();
  }

  /**
   * After `@` / settings DingTalk login succeeds, mirror auth into connector plaza state
   * so the card shows connected and Gateway allowlist includes dws.
   */
  async markDwsConnectedAfterAuth(): Promise<ConnectorViewItem | null> {
    try {
      if (cachedCatalog.length === 0) {
        await this.refreshCatalog();
      }
    } catch (error) {
      logger.warn(
        '[connectors] markDwsConnectedAfterAuth catalog failed:',
        error instanceof Error ? error.message : String(error),
      );
    }

    const descriptor = cachedCatalog.find((item) => {
      try {
        return resolveEffectiveConnector(item).binary === 'dws';
      } catch {
        return false;
      }
    });
    if (!descriptor) return null;

    try {
      const { dwsAuthStatus, dwsCheckInstalled } = await import('../utils/dws-cli');
      const { parseDwsAuthStatus } = await import('./adapters/dws-auth-status');
      const installed = await dwsCheckInstalled();
      if (!installed.installed) return null;
      const auth = await dwsAuthStatus();
      if (!auth.ok || !parseDwsAuthStatus(auth.data)) return null;

      upsertConnectorLocalItem(descriptor.id, {
        status: 'connected',
        installedVersion: installed.version ?? null,
        lastError: null,
      });
      syncConnectorGatewayArtifacts();
      return mergeViewItem(descriptor);
    } catch (error) {
      logger.warn(
        '[connectors] markDwsConnectedAfterAuth failed:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * After embedded login (connect / mid-run reauth), mirror auth into connector plaza state.
   * Looks up catalog by runtime.binary (QPath and future embedded CLIs).
   */
  async markManagedCliConnectedAfterAuth(binaryName: string): Promise<ConnectorViewItem | null> {
    const want = binaryName.trim().toLowerCase().replace(/\.exe$/i, '');
    try {
      if (cachedCatalog.length === 0) {
        await this.refreshCatalog();
      }
    } catch (error) {
      logger.warn(
        '[connectors] markManagedCliConnectedAfterAuth catalog failed:',
        error instanceof Error ? error.message : String(error),
      );
    }

    const descriptor = cachedCatalog.find((item) => {
      try {
        return resolveEffectiveConnector(item).binary === want;
      } catch {
        return false;
      }
    });
    if (!descriptor) return null;

    try {
      const runtime = getKindRuntime('managed_cli');
      const probed = await runtime.probe({ descriptor, parentWindow: null });
      if (probed.status !== 'connected' || !probed.authenticated) return null;

      upsertConnectorLocalItem(descriptor.id, {
        status: 'connected',
        installedVersion: probed.installedVersion ?? null,
        lastError: null,
      });
      syncConnectorGatewayArtifacts();
      return mergeViewItem(descriptor);
    } catch (error) {
      logger.warn(
        '[connectors] markManagedCliConnectedAfterAuth failed:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /** @deprecated use markManagedCliConnectedAfterAuth('qpath') */
  async markQpathConnectedAfterAuth(): Promise<ConnectorViewItem | null> {
    return this.markManagedCliConnectedAfterAuth('qpath');
  }

  dumpLocalState() {
    return readConnectorState();
  }

  /** Catalog descriptor by id (no status merge). */
  getDescriptor(connectorId: string) {
    return cachedCatalog.find((item) => item.id === connectorId) ?? null;
  }
}

let instance: ConnectorService | null = null;

export function getConnectorService(): ConnectorService {
  if (!instance) instance = new ConnectorService();
  return instance;
}
