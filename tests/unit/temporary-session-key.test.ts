import { describe, expect, it, vi } from 'vitest';
import {
  createTemporaryAgentSessionKey,
  getAgentIdFromSessionKey,
  isTemporaryAgentSessionKey,
} from '@/stores/chat/session-identity';

describe('temporary session keys', () => {
  it('stays compatible with temporary-session routing and preserves agent identity', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const key = createTemporaryAgentSessionKey('Project Agent', 1234);

    expect(key).toBe('agent:project agent:session-1234-00000000-0000-4000-8000-000000000001');
    expect(isTemporaryAgentSessionKey(key)).toBe(true);
    expect(getAgentIdFromSessionKey(key)).toBe('project agent');
  });

  it('does not collide when two sessions are created in the same millisecond', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

    expect(createTemporaryAgentSessionKey('main', 1234))
      .not.toBe(createTemporaryAgentSessionKey('main', 1234));
  });
});
