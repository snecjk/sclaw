import { describe, expect, it } from 'vitest';

import { findDingTalkConnectorId } from '../../shared/connectors/find-dingtalk-connector';
import type { ConnectorViewItem } from '../../shared/connectors/types';

function item(partial: Partial<ConnectorViewItem> & Pick<ConnectorViewItem, 'id' | 'name'>): ConnectorViewItem {
  return {
    description: '',
    iconUrl: '',
    kind: 'managed_cli',
    order: 0,
    badge: '',
    minClientVersion: '',
    runtime: {},
    agent: {},
    localStatus: 'available',
    ...partial,
  };
}

describe('findDingTalkConnectorId', () => {
  it('prefers managed_cli binary=dws', () => {
    const items = [
      item({
        id: 'conn-gitlab',
        name: 'GitLab',
        runtime: { binary: 'glab' },
      }),
      item({
        id: 'conn-27389885c97c',
        name: '钉钉',
        runtime: { binary: 'dws' },
      }),
    ];
    expect(findDingTalkConnectorId(items)).toBe('conn-27389885c97c');
  });

  it('falls back to name/id heuristics', () => {
    const items = [
      item({
        id: 'conn-other',
        name: 'Other',
        kind: 'unknown',
        runtime: {},
      }),
      item({
        id: 'conn-dingtalk-x',
        name: '钉钉办公',
        kind: 'unknown',
        runtime: {},
      }),
    ];
    expect(findDingTalkConnectorId(items)).toBe('conn-dingtalk-x');
  });

  it('returns null when no DingTalk connector exists', () => {
    expect(findDingTalkConnectorId([
      item({ id: 'conn-gitlab', name: 'GitLab', runtime: { binary: 'glab' } }),
    ])).toBeNull();
  });
});
