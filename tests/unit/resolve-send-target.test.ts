import { describe, expect, it, vi } from 'vitest';
import { resolveSendTarget } from '@/stores/chat/resolve-send-target';
import type { ChatState } from '@/stores/chat/types';

describe('resolveSendTarget', () => {
  it('uses an explicit background session without switching the visible conversation', async () => {
    const loadHistory = vi.fn();
    const state = {
      currentSessionKey: 'agent:main:visible',
      currentAgentId: 'main',
      sessions: [
        { key: 'agent:main:visible', engineType: 'openclaw' },
        { key: 'agent:writer:queued', engineType: 'claude' },
      ],
      messages: [],
      loadHistory,
    } as unknown as ChatState;
    const set = vi.fn();

    const target = await resolveSendTarget({
      get: () => state,
      set,
      requestedSessionKey: 'agent:writer:queued',
      resolveMainSessionKeyForAgent: () => 'agent:writer:main',
      buildSessionSwitchPatch: () => ({ currentSessionKey: 'agent:writer:queued' }),
      resolveEngineTypeForSession: (_sessions, key) => (
        key === 'agent:writer:queued' ? 'claude' : 'openclaw'
      ),
    });

    expect(target).toMatchObject({ sessionKey: 'agent:writer:queued', engineType: 'claude' });
    expect(set).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('keeps a new dialog when the selected agent already owns it', async () => {
    const loadHistory = vi.fn();
    const state = {
      currentSessionKey: 'agent:writer:session-123-abc',
      currentAgentId: 'writer',
      sessions: [{ key: 'agent:writer:session-123-abc', engineType: 'claude' }],
      messages: [],
      loadHistory,
    } as unknown as ChatState;
    const set = vi.fn();
    const resolveMainSessionKeyForAgent = vi.fn(() => 'agent:writer:main');

    const target = await resolveSendTarget({
      get: () => state,
      set,
      targetAgentId: 'writer',
      resolveMainSessionKeyForAgent,
      buildSessionSwitchPatch: () => ({ currentSessionKey: 'agent:writer:main' }),
      resolveEngineTypeForSession: () => 'claude',
    });

    expect(target.sessionKey).toBe('agent:writer:session-123-abc');
    expect(resolveMainSessionKeyForAgent).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('switches to the target agent main session and loads history', async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    let state = {
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:writer:main', engineType: 'claude' }],
      loadHistory,
    } as unknown as ChatState;
    const set = vi.fn((updater: (state: ChatState) => Partial<ChatState>) => {
      state = { ...state, ...updater(state) };
    });

    const target = await resolveSendTarget({
      get: () => state,
      set,
      targetAgentId: 'writer',
      resolveMainSessionKeyForAgent: () => 'agent:writer:main',
      buildSessionSwitchPatch: () => ({ currentSessionKey: 'agent:writer:main' }),
      resolveEngineTypeForSession: () => 'claude',
    });

    expect(set).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledWith(true);
    expect(target).toMatchObject({
      sessionKey: 'agent:writer:main',
      engineType: 'claude',
    });
  });

  it('builds DingTalk attachment extras for the selected target', async () => {
    const state = {
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main', engineType: 'openclaw' }],
      loadHistory: vi.fn(),
    } as unknown as ChatState;

    const target = await resolveSendTarget({
      get: () => state,
      set: vi.fn(),
      targetAgentId: null,
      dingTalkMentions: [{ type: 'group', displayName: 'Team', openConversationId: 'cid-1' }],
      attachments: [{
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        fileSize: 12,
        stagedPath: 'C:/tmp/report.pdf',
        preview: null,
      }],
      resolveMainSessionKeyForAgent: () => null,
      buildSessionSwitchPatch: () => ({}),
      resolveEngineTypeForSession: () => 'openclaw',
    });

    expect(target.sessionKey).toBe('agent:main:main');
    expect(target.engineType).toBe('openclaw');
    expect(target.dingTalkRpcExtras).toMatchObject({
      dingTalkMentions: [{ type: 'group', displayName: 'Team', openConversationId: 'cid-1' }],
      dingTalkSendFileIntent: true,
      dingTalkAttachedFiles: [{
        fileName: 'report.pdf',
        filePath: 'C:/tmp/report.pdf',
        mimeType: 'application/pdf',
        fileSize: 12,
      }],
    });
  });
});
