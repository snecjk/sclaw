import { describe, expect, it, beforeEach } from 'vitest';
import {
  evaluateDingTalkSendGuard,
  isBatchDwsChatMessageSend,
  isBlockedDwsSendSpamCommand,
  resetDingTalkSendRateLimitForTests,
} from '../../sto-plugin/sto-dingtalk-send-guard/dingtalk-send-guard';

describe('isBatchDwsChatMessageSend', () => {
  it('detects for-loop batch send', () => {
    const cmd = 'for i in 1 2 3; do dws chat message send --user u1 --text hi; done';
    expect(isBatchDwsChatMessageSend(cmd)).toBe(true);
    expect(isBlockedDwsSendSpamCommand(cmd)).toBe(true);
  });

  it('allows a single send command', () => {
    const cmd = 'dws chat message send --user u1 --title "消息" --text hello --format json';
    expect(isBatchDwsChatMessageSend(cmd)).toBe(false);
    expect(isBlockedDwsSendSpamCommand(cmd)).toBe(false);
  });

  it('allows dry-run even with loops', () => {
    const cmd = 'for i in 1 2; do dws chat message send --user u1 --text hi --dry-run; done';
    expect(isBlockedDwsSendSpamCommand(cmd)).toBe(false);
  });
});

describe('evaluateDingTalkSendGuard', () => {
  beforeEach(() => {
    resetDingTalkSendRateLimitForTests();
  });

  it('blocks the second send within one minute', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const first = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    const second = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toContain('每分钟最多 1 条');
    }
  });

  it('blocks batch send before rate limit applies', () => {
    const params = {
      command: 'while true; do dws chat message send --user u1 --text spam; done',
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-2' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('循环或批量');
    }
  });
});
