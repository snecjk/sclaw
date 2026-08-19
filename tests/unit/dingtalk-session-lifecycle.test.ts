import { describe, expect, it } from 'vitest';
import {
  buildNewDingTalkSessionKey,
  isDingTalkNewSessionCommand,
  resolveChannelBaseAgentId,
  resolveDingTalkSessionKey,
  shouldForceNewDingTalkSessionForEngine,
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

  it('respects a custom idle TTL', () => {
    const sixHoursMs = 6 * 60 * 60 * 1000;
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.parse('2026-07-19T18:00:00.000Z'),
      lastActivityAt: '2026-07-19T12:00:00.000Z',
      forceNew: false,
      idleTtlMs: sixHoursMs,
    })).toBe(true);
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.parse('2026-07-19T17:59:59.000Z'),
      lastActivityAt: '2026-07-19T12:00:00.000Z',
      forceNew: false,
      idleTtlMs: sixHoursMs,
    })).toBe(false);
  });

  it('does not auto-split when idle TTL is infinite (disabled)', () => {
    expect(shouldStartNewDingTalkSession({
      nowMs: Date.parse('2026-07-30T12:00:00.000Z'),
      lastActivityAt: '2026-07-19T12:00:00.000Z',
      forceNew: false,
      idleTtlMs: Number.POSITIVE_INFINITY,
    })).toBe(false);
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

  it.each([
    '新对话',
    '新会话',
    '/new',
    '/RESET',
    ' 清空上下文 ',
    '开一个新会话',
    '开启新对话',
    '请新建会话',
    '帮我清空上下文',
  ])(
    'recognizes %s as a new-session command',
    (text) => {
      expect(isDingTalkNewSessionCommand(text)).toBe(true);
    },
  );

  it.each([
    '帮我总结今天的工作',
    '开一个新会话后帮我写周报',
    '请说明什么是新会话',
  ])('does not consume normal message %s', (text) => {
    expect(isDingTalkNewSessionCommand(text)).toBe(false);
  });

  it('forces a new session when registered engine differs from binding', () => {
    expect(shouldForceNewDingTalkSessionForEngine({
      boundEngineType: 'claude',
      registeredEngineType: 'openclaw',
    })).toBe(true);
    expect(shouldForceNewDingTalkSessionForEngine({
      boundEngineType: 'openclaw',
      registeredEngineType: 'claude',
    })).toBe(true);
  });

  it('reuses when registered engine matches binding or is unknown', () => {
    expect(shouldForceNewDingTalkSessionForEngine({
      boundEngineType: 'claude',
      registeredEngineType: 'claude',
    })).toBe(false);
    expect(shouldForceNewDingTalkSessionForEngine({
      boundEngineType: 'openclaw',
      registeredEngineType: null,
    })).toBe(false);
    expect(shouldForceNewDingTalkSessionForEngine({
      boundEngineType: 'claude',
    })).toBe(false);
  });

  it('honors explicit forceNew even when engines match', () => {
    expect(shouldForceNewDingTalkSessionForEngine({
      forceNew: true,
      boundEngineType: 'claude',
      registeredEngineType: 'claude',
    })).toBe(true);
  });

  it('creates a new key when forceNew is set for engine switch', () => {
    expect(resolveDingTalkSessionKey({
      agentId: 'main',
      peerId: 'cid-1',
      now: new Date('2026-07-20T11:00:00.000Z'),
      latestSession: {
        sessionKey: 'agent:main:dingtalk:cid-1:20260719120000:a3f2',
        lastActivityAt: '2026-07-20T10:00:00.000Z',
      },
      forceNew: shouldForceNewDingTalkSessionForEngine({
        boundEngineType: 'claude',
        registeredEngineType: 'openclaw',
      }),
      nonce: 'bbbb',
    })).toBe('agent:main:dingtalk:cid-1:20260720110000:bbbb');
  });

  it('strips project agent ids so channel sessions stay on the base agent', () => {
    expect(resolveChannelBaseAgentId('proj-ws-test-2--main')).toBe('main');
    expect(resolveChannelBaseAgentId('Main')).toBe('main');
    expect(resolveChannelBaseAgentId(null)).toBe('main');
  });
});
