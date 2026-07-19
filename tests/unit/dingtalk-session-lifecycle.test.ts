import { describe, expect, it } from 'vitest';
import {
  buildNewDingTalkSessionKey,
  isDingTalkNewSessionCommand,
  resolveDingTalkSessionKey,
  shouldStartNewDingTalkSession,
} from '../../electron/channels/session-lifecycle';

describe('DingTalk session lifecycle', () => {
  it('builds a unique timestamped session key', () => {
    expect(buildNewDingTalkSessionKey(
      'Main',
      'CID:ABC',
      new Date('2026-07-19T12:10:45.123Z'),
      'a3f2',
    )).toBe('agent:main:dingtalk:cid_abc:20260719121045:a3f2');
  });

  it('reuses the active session before 24 hours of inactivity', () => {
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.parse('2026-07-20T11:00:00.000Z'),
      lastActivityAt: '2026-07-19T12:00:00.001Z',
      forceNew: false,
    })).toBe(false);
  });

  it('starts a new session after 24 hours of inactivity', () => {
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.parse('2026-07-20T12:00:00.000Z'),
      lastActivityAt: '2026-07-19T12:00:00.000Z',
      forceNew: false,
    })).toBe(true);
  });

  it('always starts a new session when explicitly requested', () => {
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.now(),
      lastActivityAt: new Date().toISOString(),
      forceNew: true,
    })).toBe(true);
  });

  it('reuses the latest active catalog session', () => {
    expect(resolveDingTalkSessionKey({
      agentId: 'main',
      peerId: 'cid-1',
      now: new Date('2026-07-20T11:59:59.000Z'),
      latestSession: {
        sessionKey: 'agent:main:dingtalk:cid-1:20260719120000:a3f2',
        lastActivityAt: '2026-07-19T12:00:00.000Z',
      },
      nonce: 'ffff',
    })).toBe('agent:main:dingtalk:cid-1:20260719120000:a3f2');
  });

  it('creates a timestamped key when the latest session expired', () => {
    expect(resolveDingTalkSessionKey({
      agentId: 'main',
      peerId: 'cid-1',
      now: new Date('2026-07-20T12:00:00.000Z'),
      latestSession: {
        sessionKey: 'agent:main:dingtalk:cid-1:20260719120000:a3f2',
        lastActivityAt: '2026-07-19T12:00:00.000Z',
      },
      nonce: 'ffff',
    })).toBe('agent:main:dingtalk:cid-1:20260720120000:ffff');
  });

  it.each(['新对话', '新会话', '/new', '/RESET', ' 清空上下文 '])(
    'recognizes %s as a new-session command',
    (text) => {
      expect(isDingTalkNewSessionCommand(text)).toBe(true);
    },
  );

  it('does not consume a normal user message', () => {
    expect(isDingTalkNewSessionCommand('帮我总结今天的工作')).toBe(false);
  });
});
