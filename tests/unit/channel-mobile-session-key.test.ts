import { describe, expect, it } from 'vitest';
import {
  buildChannelSessionKey,
  parseChannelSessionKey,
  parseDingTalkSessionKey,
} from '../../electron/message-channel/common/session-key';
import {
  shouldStartNewChannelSession,
  resolveChannelSessionKey,
} from '../../electron/message-channel/common/session-lifecycle';

describe('channel session-key', () => {
  it('builds mobile and dingtalk keys with lowercase peer', () => {
    const ding = buildChannelSessionKey('dingtalk', 'Main', 'Peer:A', new Date('2026-07-23T10:00:00Z'), 'ab12');
    const mobile = buildChannelSessionKey('mobile', 'main', 'app-conv-1', new Date('2026-07-23T10:00:00Z'), 'cd34');
    expect(ding).toBe('agent:main:dingtalk:peer_a:20260723100000:ab12');
    expect(mobile).toBe('agent:main:mobile:app-conv-1:20260723100000:cd34');
  });

  it('parses mobile keys', () => {
    const key = 'agent:main:mobile:conv1:20260723100000:abcd';
    expect(parseChannelSessionKey(key)).toEqual({
      agentId: 'main',
      channelType: 'mobile',
      peerId: 'conv1',
      startedAtToken: '20260723100000',
    });
    expect(parseDingTalkSessionKey(key)).toBeNull();
  });
});

describe('channel session-lifecycle mobile', () => {
  it('does not auto-split mobile sessions by idle TTL', () => {
    expect(
      shouldStartNewChannelSession({
        channelType: 'mobile',
        nowMs: Date.now(),
        lastActivityAt: '2020-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('still splits dingtalk after idle TTL', () => {
    expect(
      shouldStartNewChannelSession({
        channelType: 'dingtalk',
        nowMs: Date.parse('2026-07-24T00:00:00.000Z'),
        lastActivityAt: '2026-07-22T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('forceNew creates a new mobile key', () => {
    const key = resolveChannelSessionKey({
      channelType: 'mobile',
      agentId: 'main',
      peerId: 'c1',
      forceNew: true,
      latestSession: {
        sessionKey: 'agent:main:mobile:c1:old:xxxx',
        lastActivityAt: new Date().toISOString(),
      },
      now: new Date('2026-07-23T12:00:00Z'),
      nonce: 'zz99',
    });
    expect(key).toBe('agent:main:mobile:c1:20260723120000:zz99');
  });
});
