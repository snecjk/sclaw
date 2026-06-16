import { describe, expect, it, beforeEach } from 'vitest';
import {
  classifyDwsChatMessageSendCategory,
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
  isBatchDwsChatMessageSend,
  isBlockedDwsSendSpamCommand,
  isSuccessfulDwsChatMessageSendResult,
  rememberPendingDingTalkSend,
  resolveDwsChatMessageSendTextFormatProblem,
  resetDingTalkSendRateLimitForTests,
} from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/dingtalk-send-guard';

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

describe('classifyDwsChatMessageSendCategory', () => {
  it('classifies text sends', () => {
    const cmd = 'dws chat message send --user u1 --title "消息" --text hello --format json';
    expect(classifyDwsChatMessageSendCategory(cmd)).toBe('text');
  });

  it('classifies image sends', () => {
    const cmd = 'dws chat message send --user u1 --msg-type image --media-id mid1 --format json';
    expect(classifyDwsChatMessageSendCategory(cmd)).toBe('image');
  });

  it('classifies file sends as image bucket', () => {
    const cmd =
      'dws chat message send --user u1 --msg-type file --dentry-id d1 --space-id s1 --file-name "a.pdf" --format json';
    expect(classifyDwsChatMessageSendCategory(cmd)).toBe('image');
  });
});

describe('isSuccessfulDwsChatMessageSendResult', () => {
  it('accepts ok:true json', () => {
    expect(isSuccessfulDwsChatMessageSendResult(undefined, '{"ok":true,"openTaskId":"t1"}')).toBe(true);
  });

  it('rejects explicit errors', () => {
    expect(isSuccessfulDwsChatMessageSendResult('exec failed', '{"ok":false}')).toBe(false);
  });

  it('rejects empty output', () => {
    expect(isSuccessfulDwsChatMessageSendResult(undefined, '')).toBe(false);
  });
});

describe('evaluateDingTalkSendGuard', () => {
  beforeEach(() => {
    resetDingTalkSendRateLimitForTests();
  });

  it('allows two text sends before any succeeds', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const first = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    const second = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('blocks the second text send after one succeeds', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const toolCallId = 'call-text-1';
    const first = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(first.allowed).toBe(true);
    rememberPendingDingTalkSend(toolCallId, 'sess-1', 'text');
    handleDingTalkSendGuardAfter({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      toolCallId,
      result: '{"ok":true}',
    });

    const second = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toContain('文字');
    }
  });

  it('allows text and image sends in the same minute when both succeed once', () => {
    const textParams = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const imageParams = {
      command: 'dws chat message send --user u1 --msg-type image --media-id m1 --format json',
    };

    evaluateDingTalkSendGuard({ toolName: 'exec', params: textParams, sessionKey: 'sess-1' });
    rememberPendingDingTalkSend('call-text', 'sess-1', 'text');
    handleDingTalkSendGuardAfter({
      toolName: 'exec',
      params: textParams,
      sessionKey: 'sess-1',
      toolCallId: 'call-text',
      result: '{"ok":true}',
    });

    const imageDecision = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params: imageParams,
      sessionKey: 'sess-1',
    });
    expect(imageDecision.allowed).toBe(true);
  });

  it('does not count failed sends toward rate limit', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    rememberPendingDingTalkSend('call-fail', 'sess-1', 'text');
    handleDingTalkSendGuardAfter({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      toolCallId: 'call-fail',
      error: 'exit 1',
      result: '{"ok":false,"error":"rate limited"}',
    });

    const retry = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(retry.allowed).toBe(true);
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

  it('blocks Bash ANSI-C quoted --text before it reaches Windows exec', () => {
    const params = {
      command:
        "dws chat message send --user u1 --title \"消息\" --text $'你好\\n\\n---\\n\\n> *本消息由 STO Claw 代为发送，非本人实时回复。*' --format json",
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('OpenClaw/Windows');
      expect(result.reason).toContain('$');
    }
    expect(resolveDwsChatMessageSendTextFormatProblem(params.command)).toContain('--text');
  });

  it('blocks shell variable --text because it can collapse to --format', () => {
    const params = {
      command:
        'powershell -NoProfile -Command "$nl = [Environment]::NewLine; $text = \'你好\' + $nl + $nl + \'---\' + $nl + $nl + \'> *本消息由 STO Claw 代为发送，非本人实时回复。*\'; dws chat message send --user u1 --title \'消息\' --text $text --format json"',
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
    expect(resolveDwsChatMessageSendTextFormatProblem(params.command)).toContain('--format');
  });

  it('allows direct quoted text with literal newline escapes for gateway argv normalization', () => {
    const params = {
      command:
        'dws chat message send --user u1 --title "消息" --text "你好\\n\\n---\\n\\n> *本消息由 STO Claw 代为发送，非本人实时回复。*" --format json',
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(true);
    expect(resolveDwsChatMessageSendTextFormatProblem(params.command)).toBeNull();
  });
});
