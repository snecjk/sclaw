import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeConnectorState } from '../../shared/connectors/state-schema';
import type { ConnectorDescriptor } from '../../shared/connectors/types';

const home = mkdtempSync(join(tmpdir(), 'stoclaw-connectors-'));

describe('connector state schema', () => {
  it('normalizes valid items and drops invalid status', () => {
    const state = normalizeConnectorState({
      version: 1,
      items: {
        ok: { status: 'connected', installedVersion: '1.0.0', lastError: null, updatedAt: 1 },
        bad: { status: 'nope', updatedAt: 2 },
      },
    });
    expect(state.items.ok?.status).toBe('connected');
    expect(state.items.bad).toBeUndefined();
  });
});

describe('gateway allowlist rebuild', () => {
  beforeEach(() => {
    process.env.STOCLAW_CONNECTORS_DIR = home;
    vi.resetModules();
  });

  it('writes allowlist only for connected connectors', async () => {
    const { upsertConnectorLocalItem } = await import('../../electron/connectors/state-store');
    const {
      setConnectorCatalog,
      getGatewayAllowlist,
      getGatewayAllowlistFilePath,
      rebuildGatewayAllowlist,
    } = await import('../../electron/connectors/gateway-allowlist');

    const descriptor: ConnectorDescriptor = {
      id: 'dingtalk-dws',
      name: '钉钉 CLI',
      description: '',
      iconUrl: '',
      kind: 'managed_cli',
      order: 10,
      badge: '',
      minClientVersion: '',
      runtime: {
        binary: 'dws',
        gateway: { allowBinary: 'dws', denyArgs: ['upgrade', 'install'] },
      },
      agent: {},
    };

    setConnectorCatalog([descriptor]);
    expect(getGatewayAllowlist()).toEqual([]);

    upsertConnectorLocalItem('dingtalk-dws', { status: 'connected', installedVersion: '1.2.3' });
    const entries = rebuildGatewayAllowlist();
    expect(entries).toEqual([
      { connectorId: 'dingtalk-dws', allowBinary: 'dws', denyArgs: ['upgrade', 'install'] },
    ]);

    const raw = JSON.parse(readFileSync(getGatewayAllowlistFilePath(), 'utf8')) as {
      entries: unknown[];
    };
    expect(raw.entries).toHaveLength(1);

    upsertConnectorLocalItem('dingtalk-dws', { status: 'installed' });
    expect(rebuildGatewayAllowlist()).toEqual([]);
  });

  it('expands allowBinaries for glab + git', async () => {
    const { upsertConnectorLocalItem } = await import('../../electron/connectors/state-store');
    const {
      setConnectorCatalog,
      rebuildGatewayAllowlist,
    } = await import('../../electron/connectors/gateway-allowlist');

    const descriptor: ConnectorDescriptor = {
      id: 'conn-gitlab',
      name: 'GitLab',
      description: '',
      iconUrl: '',
      kind: 'managed_cli',
      order: 20,
      badge: '',
      minClientVersion: '',
      runtime: {
        binary: 'glab',
        gateway: {
          allowBinary: 'glab',
          allowBinaries: ['git'],
          denyArgs: ['upgrade', 'install'],
        },
      },
      agent: {},
    };

    setConnectorCatalog([descriptor]);
    upsertConnectorLocalItem('conn-gitlab', { status: 'connected' });
    expect(rebuildGatewayAllowlist()).toEqual([
      { connectorId: 'conn-gitlab', allowBinary: 'glab', denyArgs: ['upgrade', 'install'] },
      { connectorId: 'conn-gitlab', allowBinary: 'git', denyArgs: ['upgrade', 'install'] },
    ]);
  });

  it('rewrites catalog api_token GitLab into glab allowlist entries', async () => {
    const { upsertConnectorLocalItem } = await import('../../electron/connectors/state-store');
    const {
      setConnectorCatalog,
      rebuildGatewayAllowlist,
    } = await import('../../electron/connectors/gateway-allowlist');

    const descriptor: ConnectorDescriptor = {
      id: 'gitlab',
      name: 'GitLab',
      description: '',
      iconUrl: '',
      kind: 'api_token',
      order: 20,
      badge: '',
      minClientVersion: '',
      runtime: {
        auth: { type: 'api_token' },
        serverUrlHint: 'https://gitlab.sto.cn',
      },
      agent: {},
    };

    setConnectorCatalog([descriptor]);
    upsertConnectorLocalItem('gitlab', { status: 'connected', serverUrl: 'https://gitlab.sto.cn' });
    const entries = rebuildGatewayAllowlist();
    expect(entries.map((e) => e.allowBinary).sort()).toEqual(['git', 'glab']);
  });

  it('persists catalog gated binaries even when nothing is connected', async () => {
    const {
      setConnectorCatalog,
      getCatalogGatedBinaries,
    } = await import('../../electron/connectors/gateway-allowlist');
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const descriptor: ConnectorDescriptor = {
      id: 'dingtalk-dws',
      name: '钉钉 CLI',
      description: '',
      iconUrl: '',
      kind: 'managed_cli',
      order: 10,
      badge: '',
      minClientVersion: '',
      runtime: {
        binary: 'dws',
        gateway: { allowBinary: 'dws', denyArgs: ['upgrade', 'install'] },
      },
      agent: {},
    };

    setConnectorCatalog([descriptor]);
    expect(getCatalogGatedBinaries()).toEqual(['dws']);
    const file = join(process.env.STOCLAW_CONNECTORS_DIR!, 'gateway-gated-binaries.json');
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { binaries: string[] };
    expect(raw.binaries).toEqual(['dws']);
  });
});

afterAll(() => {
  delete process.env.STOCLAW_CONNECTORS_DIR;
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
