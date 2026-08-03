import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorDescriptor } from '../../shared/connectors/types';

const home = mkdtempSync(join(tmpdir(), 'stoclaw-connector-index-'));

const sampleCatalog: ConnectorDescriptor[] = [
  {
    id: 'conn-dingtalk',
    name: '钉钉',
    description: '钉钉 CLI',
    iconUrl: '',
    kind: 'managed_cli',
    order: 10,
    badge: '',
    minClientVersion: '',
    runtime: { binary: 'dws', gateway: { allowBinary: 'dws' } },
    agent: {
      summary: '通讯录、发消息',
      examples: ['查联系人'],
      skill: { slug: 'dws', scope: 'connector', source: 'bundled' },
    },
  },
  {
    id: 'conn-gitlab',
    name: 'GitLab',
    description: 'GitLab',
    iconUrl: '',
    kind: 'managed_cli',
    order: 20,
    badge: '',
    minClientVersion: '',
    runtime: { binary: 'glab', gateway: { allowBinary: 'glab', allowBinaries: ['git'] } },
    agent: { summary: '项目、MR' },
  },
];

describe('connector-index agent prompt', () => {
  beforeEach(() => {
    process.env.STOCLAW_CONNECTORS_DIR = home;
    vi.resetModules();
  });

  it('lists all catalog connectors with local status labels', async () => {
    const { upsertConnectorLocalItem } = await import('../../electron/connectors/state-store');
    upsertConnectorLocalItem('conn-dingtalk', { status: 'installed' });
    upsertConnectorLocalItem('conn-gitlab', { status: 'connected' });

    const serviceMod = await import('../../electron/connectors/connector-service');
    vi.spyOn(serviceMod.getConnectorService(), 'getCachedCatalog').mockReturnValue(sampleCatalog);

    const { buildConnectorIndexAgentPrompt } = await import('../../electron/connectors/agent-context');
    const prompt = buildConnectorIndexAgentPrompt();

    expect(prompt).toContain('连接器清单');
    expect(prompt).toContain('钉钉（dws）· 已安装未连接');
    expect(prompt).toContain('GitLab（glab）· 已连接');
    expect(prompt).toContain('通讯录、发消息');
    expect(prompt).toContain('当前未连接（不可调用 detail skill / CLI）：钉钉');
    expect(prompt).toContain('Skill(slug)');
  });
});

describe('connector bash gate', () => {
  beforeEach(() => {
    process.env.STOCLAW_CONNECTORS_DIR = home;
    vi.resetModules();
  });

  it('denies dws when not in allowlist', async () => {
    const { setConnectorCatalog } = await import('../../electron/connectors/gateway-allowlist');
    setConnectorCatalog(sampleCatalog);

    const { createConnectorBashGateHook } = await import('../../electron/connectors/claude-binary-gate');
    const hook = createConnectorBashGateHook();
    const result = await hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'dws aisearch person 李峥' },
    } as never);

    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows dws when connected', async () => {
    const { upsertConnectorLocalItem } = await import('../../electron/connectors/state-store');
    const { setConnectorCatalog, rebuildGatewayAllowlist } = await import(
      '../../electron/connectors/gateway-allowlist'
    );
    setConnectorCatalog(sampleCatalog);
    upsertConnectorLocalItem('conn-dingtalk', { status: 'connected' });
    rebuildGatewayAllowlist();

    const { createConnectorBashGateHook } = await import('../../electron/connectors/claude-binary-gate');
    const hook = createConnectorBashGateHook();
    const result = await hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'dws auth status' },
    } as never);

    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
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
