import { describe, expect, it, vi } from 'vitest';
import { resolveSendTarget } from '@/stores/chat/resolve-send-target';
import type { ChatState } from '@/stores/chat/types';

describe('resolveSendTarget', () => {
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
