import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthState = vi.fn();

vi.mock('../../electron/utils/auth-store', () => ({
  getAuthState: () => getAuthState(),
}));

import { buildAgentLoopRequestEnv } from '../../electron/utils/agentloop-context';

describe('AgentLoop request user context', () => {
  beforeEach(() => {
    getAuthState.mockReset();
  });

  it('injects the current employee code with the Sclaw prefix without mutating the shared env', async () => {
    const baseEnv = { ANTHROPIC_API_KEY: 'key', GEN_AI_USER_ID: 'previous-user' };
    getAuthState.mockResolvedValue({
      user: { id: 'internal-user-id', code: ' 1460933 ' },
    });

    const env = await buildAgentLoopRequestEnv(baseEnv);

    expect(env).toEqual({ ANTHROPIC_API_KEY: 'key', GEN_AI_USER_ID: 'Sclaw_1460933' });
    expect(baseEnv.GEN_AI_USER_ID).toBe('previous-user');
  });

  it('does not fall back to the SSO internal ID when the employee code is missing', async () => {
    getAuthState.mockResolvedValue({ user: { id: 'internal-user-id', code: ' ' } });

    await expect(buildAgentLoopRequestEnv({})).resolves.toEqual({});
  });

  it('removes stale user IDs when there is no authenticated user', async () => {
    getAuthState.mockResolvedValue({ user: null });

    await expect(buildAgentLoopRequestEnv({
      GEN_AI_USER_ID: 'previous-user',
      CMS_USER_ID: 'legacy-user',
    })).resolves.toEqual({});
  });

  it('fails open without retaining a stale user ID when auth lookup fails', async () => {
    getAuthState.mockRejectedValue(new Error('auth unavailable'));

    await expect(buildAgentLoopRequestEnv({
      PATH: 'bin',
      GEN_AI_USER_ID: 'previous-user',
    })).resolves.toEqual({ PATH: 'bin' });
  });
});
