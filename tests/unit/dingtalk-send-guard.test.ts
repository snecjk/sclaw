import { describe, expect, it, beforeEach } from 'vitest';
import {
  classifyDwsChatMessageSendCategory,
  evaluateDingTalkSendGuard,
  handleDingTalkSendGuardAfter,
  isBatchDwsChatMessageSend,
  isBlockedDwsSendSpamCommand,
  isSuccessfulDwsChatMessageSendResult,
  rememberPendingDingTalkSend,
  resolveDwsChatMessageSendFileProtocolInText,
  resolveDwsChatMessageSendHeredocOrLostHeadingProblem,
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

  it('blocks the second text send before any succeeds (initiate counts)', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const t0 = 1_000_000;
    const first = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      now: t0,
    });
    const second = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      now: t0 + 5_000,
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toContain('文字');
    }
  });

  it('unblocks the next text send after the 20s initiate window elapses', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const t0 = 1_000_000;
    expect(
      evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1', now: t0 }).allowed,
    ).toBe(true);
    expect(
      evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1', now: t0 + 19_999 })
        .allowed,
    ).toBe(false);
    expect(
      evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1', now: t0 + 20_001 })
        .allowed,
    ).toBe(true);
  });

  it('exempts scheduled-task session keys from the 20s per-send limit', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const t0 = 1_000_000;
    for (const sessionKey of [
      'claude-task-run:abc',
      'claude-task:task-1:2026-06-25',
      'claude-task:task-1',
      'scheduled-task:xyz',
      'agent:foo:cron:bar:baz',
      '[cron:nightly]',
    ]) {
      resetDingTalkSendRateLimitForTests();
      const first = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey, now: t0 });
      const second = evaluateDingTalkSendGuard({
        toolName: 'exec',
        params,
        sessionKey,
        now: t0 + 1_000,
      });
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
    }
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

  it('counts a failed send toward the 20s initiate window (retry blocked, later allowed)', () => {
    const params = {
      command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
    };
    const t0 = 1_000_000;
    evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1', now: t0 });
    rememberPendingDingTalkSend('call-fail', 'sess-1', 'text');
    handleDingTalkSendGuardAfter({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      toolCallId: 'call-fail',
      error: 'exit 1',
      result: '{"ok":false,"error":"rate limited"}',
      now: t0,
    });

    // 发起即计：失败重试在 20s 窗口内仍被挡（防止 example→summary 双发刷量）。
    const retry = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      now: t0 + 5_000,
    });
    expect(retry.allowed).toBe(false);

    // 窗口过后放行。
    const later = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params,
      sessionKey: 'sess-1',
      now: t0 + 20_001,
    });
    expect(later.allowed).toBe(true);
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
        "dws chat message send --user u1 --title \"消息\" --text $'你好\\n\\n---\\n\\n> *本消息由 SClaw 代为发送，非本人实时回复。*' --format json",
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
        'powershell -NoProfile -Command "$nl = [Environment]::NewLine; $text = \'你好\' + $nl + $nl + \'---\' + $nl + $nl + \'> *本消息由 SClaw 代为发送，非本人实时回复。*\'; dws chat message send --user u1 --title \'消息\' --text $text --format json"',
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
    expect(resolveDwsChatMessageSendTextFormatProblem(params.command)).toContain('--format');
  });

  it('allows direct quoted text with literal newline escapes for gateway argv normalization', () => {
    const params = {
      command:
        'dws chat message send --user u1 --title "消息" --text "你好\\n\\n---\\n\\n> *本消息由 SClaw 代为发送，非本人实时回复。*" --format json',
    };
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(true);
    expect(resolveDwsChatMessageSendTextFormatProblem(params.command)).toBeNull();
  });

  it('blocks shell heredoc --text payloads', () => {
    const command =
      "dws chat message send --user xxx --text $(cat <<'EOF'\n# 标题\nEOF)";
    expect(resolveDwsChatMessageSendHeredocOrLostHeadingProblem(command)).toContain('heredoc');
    const result = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params: { command },
      sessionKey: 'sess-1',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('heredoc');
    }
  });

  it('blocks leftover I + CJK heading after shell ate #', () => {
    const command = 'dws chat message send --user xxx --text "I 标题"';
    expect(resolveDwsChatMessageSendHeredocOrLostHeadingProblem(command)).toContain('I 中文');
    const result = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params: { command },
      sessionKey: 'sess-1',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('I 中文');
    }
  });

  it('allows quoted markdown headings and ordinary text for heredoc/heading checks', () => {
    expect(
      resolveDwsChatMessageSendHeredocOrLostHeadingProblem(
        'dws chat message send --user xxx --text "### 标题\\n\\n正文"',
      ),
    ).toBeNull();
    expect(
      resolveDwsChatMessageSendHeredocOrLostHeadingProblem(
        'dws chat message send --user xxx --text "正常消息"',
      ),
    ).toBeNull();
    expect(
      resolveDwsChatMessageSendHeredocOrLostHeadingProblem(
        'dws chat message send --user xxx --text "I like this"',
      ),
    ).toBeNull();
  });
});

describe('resolveDwsChatMessageSendFileProtocolInText', () => {
  beforeEach(() => {
    resetDingTalkSendRateLimitForTests();
  });

  it('blocks file:// path in --text and points to temporary OSS first', () => {
    const cmd =
      'dws chat message send --user u1 --text "周报：file:///Users/yaolei/.claw-output/report.html" --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).not.toBeNull();
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params: { command: cmd }, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('本地产物路径');
      expect(result.reason).toContain('upload_file_to_temp_oss');
      expect(result.reason).toContain('data.url');
      expect(result.reason).toContain('![文件名](在线地址)');
      expect(result.reason).toContain('[文件名](在线地址)');
      expect(result.reason).toContain('dws drive upload');
      expect(result.reason).toContain('docUrl');
      expect(result.reason).toContain('encodeURI');
      expect(result.reason.indexOf('upload_file_to_temp_oss')).toBeLessThan(
        result.reason.indexOf('dws drive upload'),
      );
    }
  });

  it('blocks bare absolute .claw-output path in --text', () => {
    const cmd =
      'dws chat message send --user u1 --text "报告：/Users/yaolei/.stoclaw/workspace/.claw-output/客户异常监控20260724_151406.html" --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).not.toBeNull();
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params: { command: cmd }, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('本地产物路径');
      expect(result.reason).toContain('upload_file_to_temp_oss');
      expect(result.reason).toContain('drive upload');
    }
  });

  it('blocks file:// even on --dry-run (content issue, preview should be caught)', () => {
    const cmd =
      'dws chat message send --user u1 --text "see file:///x.html" --dry-run --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).not.toBeNull();
    const result = evaluateDingTalkSendGuard({ toolName: 'exec', params: { command: cmd }, sessionKey: 'sess-1' });
    expect(result.allowed).toBe(false);
  });

  it('allows http(s) artifact urls in --text', () => {
    const cmd =
      'dws chat message send --user u1 --text "周报：https://example.com/report.html" --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).toBeNull();
    expect(
      evaluateDingTalkSendGuard({ toolName: 'exec', params: { command: cmd }, sessionKey: 'sess-1' }).allowed,
    ).toBe(true);
  });

  it('ignores file:// when the command is a drive upload, not a chat send', () => {
    const cmd =
      'dws drive upload --file file:///Users/yaolei/.claw-output/report.html --space-id sid -y --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).toBeNull();
  });

  it('does not false-positive on a stripped local path passed to --file', () => {
    const cmd =
      'dws drive upload --file /Users/yaolei/.claw-output/report.html --space-id sid -y --format json && dws chat message send --user u1 --text "周报已上传" --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).toBeNull();
    // chained upload+send with stripped path: send itself is allowed (scheduled-task session exempts rate limit)
    const result = evaluateDingTalkSendGuard({
      toolName: 'exec',
      params: { command: cmd },
      sessionKey: 'scheduled-task:job-1',
    });
    expect(result.allowed).toBe(true);
  });

  it('does not false-positive when chained upload uses file:// --file and send text is clean', () => {
    const cmd =
      'dws drive upload --file file:///Users/yaolei/.claw-output/report.html -y --format json && dws chat message send --user u1 --text "报告：https://dingtalk.doc/url" --format json';
    expect(resolveDwsChatMessageSendFileProtocolInText(cmd)).toBeNull();
  });
});
