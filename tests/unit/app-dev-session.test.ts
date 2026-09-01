import { describe, expect, it } from 'vitest';
import {
  buildAppDevSessionKey,
  ensureAppDevSessionEntry,
  getWorkspaceIdFromAppDevSessionKey,
  isAppDevSessionKey,
} from '@/lib/app-dev-session';

describe('app-dev-session helpers', () => {
  it('builds and parses a stable app-dev session key', () => {
    const key = buildAppDevSessionKey('proj-agent', 'workspace-1');
    expect(key).toBe('agent:proj-agent:appdev:workspace-1');
    expect(isAppDevSessionKey(key)).toBe(true);
    expect(getWorkspaceIdFromAppDevSessionKey(key)).toBe('workspace-1');
  });

  it('upserts an app-dev session entry without duplicating rows', () => {
    const sessionKey = buildAppDevSessionKey('proj-agent', 'workspace-1');
    const initial = ensureAppDevSessionEntry({
      sessions: [],
      sessionKey,
      engineType: 'claude',
      agentId: 'proj-agent',
    });
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      key: sessionKey,
      engineType: 'claude',
      agentId: 'proj-agent',
    });

    const updated = ensureAppDevSessionEntry({
      sessions: initial,
      sessionKey,
      engineType: 'openclaw',
      agentId: 'proj-agent',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.engineType).toBe('openclaw');
  });
});
