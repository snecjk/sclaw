import { describe, expect, it } from 'vitest';
import { bindingToRegistryEntry } from '../../electron/engines/session-binding-map';
import type { SessionEngineBinding } from '../../electron/db/models/domain/session-catalog';

describe('bindingToRegistryEntry', () => {
  it('maps sqlite binding row back to engine registry entry', () => {
    const binding: SessionEngineBinding = {
      sessionKey: 'agent:main:session-1',
      engineType: 'claude',
      agentId: 'main',
      engineSessionId: 'sess-123',
      cwd: '/tmp/project',
      model: 'claude-sonnet',
      accountId: 'acc-1',
      extra: {
        title: 'My chat',
        archivedClaudeSessionIds: ['old-1'],
        pendingHistoryBridge: true,
      },
      createdAt: '2026-07-11T08:00:00.000Z',
      updatedAt: '2026-07-11T09:00:00.000Z',
      deletedAt: null,
      version: 1,
      createdBy: null,
      updatedBy: null,
    };

    const entry = bindingToRegistryEntry(binding);
    expect(entry).toMatchObject({
      sessionKey: 'agent:main:session-1',
      engineType: 'claude',
      agentId: 'main',
      sessionId: 'sess-123',
      cwd: '/tmp/project',
      model: 'claude-sonnet',
      accountId: 'acc-1',
      title: 'My chat',
      archivedClaudeSessionIds: ['old-1'],
      pendingHistoryBridge: true,
    });
    expect(entry.updatedAt).toBe(Date.parse('2026-07-11T09:00:00.000Z'));
  });
});
