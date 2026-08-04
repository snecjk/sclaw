import { describe, expect, it } from 'vitest';

import { resolveEffectiveConnector } from '../../shared/connectors/resolve-effective-runtime';
import type { ConnectorDescriptor } from '../../shared/connectors/types';

function base(partial: Partial<ConnectorDescriptor> & Pick<ConnectorDescriptor, 'id' | 'kind'>): ConnectorDescriptor {
  return {
    name: partial.name || partial.id,
    description: '',
    iconUrl: '',
    order: 1,
    badge: '',
    minClientVersion: '',
    runtime: {},
    agent: {},
    ...partial,
  };
}

describe('resolveEffectiveConnector', () => {
  it('rewrites catalog api_token GitLab into managed_cli + glab', () => {
    const effective = resolveEffectiveConnector(
      base({
        id: 'gitlab',
        kind: 'api_token',
        runtime: {
          auth: { type: 'api_token', hint: 'PAT' },
          serverUrlHint: 'https://gitlab.sto.cn',
        },
      }),
    );

    expect(effective.isGlab).toBe(true);
    expect(effective.kind).toBe('managed_cli');
    expect(effective.binary).toBe('glab');
    expect(effective.descriptor.kind).toBe('managed_cli');
    expect(effective.descriptor.runtime.binary).toBe('glab');
    const gateway = effective.descriptor.runtime.gateway as Record<string, unknown>;
    expect(gateway.allowBinary).toBe('glab');
    expect(gateway.allowBinaries).toEqual(expect.arrayContaining(['git']));
    expect(gateway.denyArgs).toEqual(expect.arrayContaining(['upgrade', 'install']));
  });

  it('keeps explicit managed_cli glab as glab', () => {
    const effective = resolveEffectiveConnector(
      base({
        id: 'gitlab-cli',
        kind: 'managed_cli',
        runtime: {
          binary: 'glab',
          gateway: { allowBinary: 'glab', allowBinaries: ['git'] },
        },
      }),
    );
    expect(effective.isGlab).toBe(true);
    expect(effective.kind).toBe('managed_cli');
    expect(effective.binary).toBe('glab');
  });

  it('does not rewrite unrelated api_token connectors to glab', () => {
    const effective = resolveEffectiveConnector(
      base({
        id: 'corp-mail',
        kind: 'api_token',
        runtime: {
          auth: { type: 'api_token' },
          serverUrlHint: 'https://mail.example.com',
        },
      }),
    );
    expect(effective.isGlab).toBe(false);
    expect(effective.kind).toBe('api_token');
    expect(effective.binary).toBe('');
    expect(effective.descriptor.kind).toBe('api_token');
  });

  it('keeps dws managed_cli unchanged', () => {
    const effective = resolveEffectiveConnector(
      base({
        id: 'dingtalk-dws',
        kind: 'managed_cli',
        runtime: { binary: 'dws', gateway: { allowBinary: 'dws' } },
      }),
    );
    expect(effective.isGlab).toBe(false);
    expect(effective.binary).toBe('dws');
    expect(effective.kind).toBe('managed_cli');
  });
});
