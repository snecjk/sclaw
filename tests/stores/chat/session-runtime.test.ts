import { describe, expect, it } from 'vitest';
import { initialChatDataState } from '../../../src/stores/chat/initial-state';
import { buildSessionSwitchPatch, createIdleSessionRuntimeState } from '../../../src/stores/chat/session-runtime';

describe('buildSessionSwitchPatch', () => {
  it('persists the leaving runtime and restores the destination runtime', () => {
    const destinationRuntime = {
      ...createIdleSessionRuntimeState(),
      sending: true,
      activeRunId: 'run-background',
      streamingText: 'working',
    };
    const patch = buildSessionSwitchPatch({
      ...initialChatDataState,
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }, { key: 'agent:writer:main' }],
      messages: [{ role: 'user', content: 'keep this history' }],
      sending: true,
      activeRunId: 'run-current',
      streamingText: 'current work',
      runtimeBySessionKey: { 'agent:writer:main': destinationRuntime },
    }, 'agent:writer:main', () => 'openclaw');

    expect(patch.currentSessionKey).toBe('agent:writer:main');
    expect(patch.currentAgentId).toBe('writer');
    expect(patch.messages).toEqual([]);
    expect(patch.sending).toBe(true);
    expect(patch.activeRunId).toBe('run-background');
    expect(patch.streamingText).toBe('working');
    expect(patch.runtimeBySessionKey?.['agent:main:main']).toMatchObject({
      activeRunId: 'run-current',
      streamingText: 'current work',
    });
  });

  it('removes an untouched temporary session rather than leaving a sidebar ghost', () => {
    const temporaryKey = 'agent:main:session-123';
    const patch = buildSessionSwitchPatch({
      ...initialChatDataState,
      currentSessionKey: temporaryKey,
      sessions: [{ key: temporaryKey }],
    }, 'agent:main:main', () => 'openclaw');

    expect(patch.sessions).toEqual([{ key: 'agent:main:main', engineType: 'openclaw' }]);
    expect(patch.runtimeBySessionKey?.[temporaryKey]).toBeUndefined();
  });
});
