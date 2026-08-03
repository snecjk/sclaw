import { describe, expect, it, vi } from 'vitest';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-prompts/dingtalk-disclaimer';
import { buildDingTalkMentionSystemContext } from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import {
  buildDwsChatMessageSendAgentCommandExample,
  buildWin32DirectDwsExecNodeCommand,
  dwsChatMessageSendTextContainsLocalArtifactPath,
  extractNormalizedDwsSendArgv,
  fixDwsChatMessageSendShellScript,
  fixDwsChatMessageSendToolParams,
  fixDwsChatMessageSendToolParamsForOpenClawExec,
  normalizeArtifactUrl,
  normalizeDwsChatMessageSendText,
  parseDwsChatMessageSendShellCommandArgs,
  rewriteDwsSendSpawnInvocation,
  shellQuoteDwsSendTextForPowerShell,
  textContainsLocalArtifactPath,
  tryParseDwsSendExecInvocation,
} from '../../shared/dingtalk-send/dws-send-text';
import {
  normalizeDwsChatMessageSendText as pluginNormalize,
} from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dws-send-text';

const cmd =
  'dws chat message send --user u1 --title "消息" --text "### 标题\\n\\n- **早上**：多云\\n\\n---\\n\\n> *本消息由 S Claw 代为发送，非本人实时回复。*" --format json';

const weatherCmd =
  'dws chat message send --user u1 --title "上海明日天气" --text "### ☀️ 上海明日天气预报（6月29日 周一）\\n\\n**🌡️ 气温：23°C ~ 27°C**\\n\\n**☁️ 天气概况：**\\n- 上午：晴到多云\\n\\n---\\n\\n> *本消息由 S Claw 代为发送，非本人实时回复。*" --format json';

describe('dws-send-text normalization', () => {
  it('shared: converts shell script --text with literal \\n to bash $\'...\'', () => {
    const fixed = fixDwsChatMessageSendShellScript(cmd);
    expect(fixed).toContain("$'");
    expect(fixed).not.toMatch(/--text\s+"[^"]*\\n/);
  });

  it('shared: unescapes double-quoted \\n sequences', () => {
    const normalized = normalizeDwsChatMessageSendText(
      '"### 标题\\n\\n- **早上**：多云"',
    );
    expect(normalized).toContain('\n- **早上**');
    expect(normalized).not.toContain('\\n');
  });

  it('plugin copy: unescapes double-quoted \\n sequences', () => {
    const normalized = pluginNormalize('"### 标题\\n\\n- **早上**：多云"');
    expect(normalized).toContain('\n- **早上**');
    expect(normalized).not.toContain('\\n');
  });

  it('fixDwsChatMessageSendToolParams rewrites exec tool command', () => {
    const params = { command: cmd };
    const fixed = fixDwsChatMessageSendToolParams(params);
    expect(fixed?.command).toContain("$'");
    expect(fixed?.command).not.toMatch(/--text\s+"[^"]*\\n/);
  });

  it('fixDwsChatMessageSendToolParams rewrites exec tool command on win32 (Claude/bash still uses $\'...\' )', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      const params = { command: cmd };
      const fixed = fixDwsChatMessageSendToolParams(params);
      expect(fixed?.command).toContain("$'");
      expect(fixed?.command).not.toMatch(/--text\s+"[^"]*\\n/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fixDwsChatMessageSendToolParamsForOpenClawExec uses win32 node execFileSync on win32', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      const params = { command: cmd };
      const fixed = fixDwsChatMessageSendToolParamsForOpenClawExec(params);
      expect(fixed?.command).toContain('execFileSync');
      expect(fixed?.command).toContain('dws.exe');
      expect(fixed?.command).not.toContain("$'");
      expect(fixed?.command).not.toMatch(/--text\s+"[^"]*\\n/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shellQuoteDwsSendTextForPowerShell emits single-line backtick-n escapes', () => {
    const body = '### 标题\n\n- **早上**：多云';
    const quoted = shellQuoteDwsSendTextForPowerShell(body);
    expect(quoted).toMatch(/^"[^"]*`n/);
    expect(quoted).not.toContain('\n');
    expect(quoted).toContain('### 标题');
    expect(quoted).toContain('**早上**');
  });

  it('parseDwsChatMessageSendShellCommandArgs understands PowerShell-quoted --text', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      const fixed = fixDwsChatMessageSendShellScript(cmd, { execShell: 'powershell' });
      const args = parseDwsChatMessageSendShellCommandArgs(fixed);
      expect(args).toBeTruthy();
      const text = args?.[(args?.indexOf('--text') ?? -2) + 1] as string;
      expect(text).toContain('### 标题');
      expect(text).toContain('\n- **早上**');
      expect(text).not.toContain('\\n');
      expect(text).not.toContain('`n');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tryParseDwsSendExecInvocation extracts dws argv from PowerShell -Command spawn', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      const openClawFixed = fixDwsChatMessageSendToolParamsForOpenClawExec({ command: cmd });
      expect(openClawFixed?.command).toBeTruthy();
      const parsed = tryParseDwsSendExecInvocation('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        openClawFixed!.command as string,
      ]);
      expect(parsed?.[0]).toBe('chat');
      const text = parsed?.[(parsed.indexOf('--text') ?? -2) + 1] as string;
      expect(text).toContain('\n- **早上**');
      expect(text).not.toContain('\\n');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rewriteDwsSendSpawnInvocation rewrites PowerShell wrapper to direct dws.exe spawn', () => {
    const rewritten = rewriteDwsSendSpawnInvocation(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { platform: 'win32' },
    );
    expect(rewritten?.cmd).toBe('dws.exe');
    expect(rewritten?.args[0]).toBe('chat');
    const text = rewritten?.args[(rewritten.args.indexOf('--text') ?? -2) + 1] as string;
    expect(text).toContain('\n- **早上**');
  });

  it('rewriteDwsSendSpawnInvocation keeps bash spawn on Claude path without forcing dws.exe rewrite incorrectly', () => {
    const fixed = fixDwsChatMessageSendToolParams({ command: cmd });
    const rewritten = rewriteDwsSendSpawnInvocation(
      '/bin/bash',
      ['-c', fixed!.command as string],
      { platform: 'darwin' },
    );
    expect(rewritten?.cmd).toBe('dws');
    const text = rewritten?.args[(rewritten!.args.indexOf('--text') ?? -2) + 1] as string;
    expect(text).toContain('\n- **早上**');
  });

  it('fixDwsChatMessageSendToolParamsForOpenClawExec uses win32 node execFileSync bypass', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      const fixed = fixDwsChatMessageSendToolParamsForOpenClawExec({ command: weatherCmd });
      expect(fixed?.command).toContain('execFileSync');
      expect(fixed?.command).toContain('dws.exe');
      expect(fixed?.command).not.toContain('\\\\n');
      expect(fixed?.command).not.toMatch(/--text\s+"[^"]*\\n/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('buildWin32DirectDwsExecNodeCommand round-trips weather argv through node script parse', () => {
    const nodeCmd = buildWin32DirectDwsExecNodeCommand(weatherCmd);
    expect(nodeCmd).toBeTruthy();
    const argv = extractNormalizedDwsSendArgv(weatherCmd);
    expect(argv).toBeTruthy();
    const text = argv?.[(argv.indexOf('--text') ?? -2) + 1] as string;
    expect(text).toContain('### ☀️ 上海明日天气预报');
    expect(text).toContain('\n- 上午：晴到多云');
    expect(text).not.toContain('\\n');

    const parsed = tryParseDwsSendExecInvocation('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      nodeCmd!,
    ]);
    expect(parsed?.[(parsed.indexOf('--text') ?? -2) + 1]).toContain('\n- 上午：晴到多云');
  });

  it('prompt example round-trips through fixDwsChatMessageSendShellScript', () => {
    const example = buildDwsChatMessageSendAgentCommandExample({
      recipientKind: 'user',
      recipientId: 'u1',
      text: appendDingTalkAgentSendDisclaimer('你好'),
    });
    const fixed = fixDwsChatMessageSendShellScript(example);
    expect(fixed).toContain("$'");
    expect(fixed).not.toMatch(/--text\s+"[^"]*\\n/);
  });

  it('mention context prefill examples round-trip through fixDwsChatMessageSendShellScript', () => {
    const context = buildDingTalkMentionSystemContext([
      { type: 'user', displayName: '张三', userId: 'u1' },
    ], { explicitSendIntent: true });
    const exampleLine = context
      .split('\n')
      .find((line) => /^- .+: dws chat message send --user u1 /.test(line));
    expect(exampleLine).toBeDefined();
    const command = exampleLine!.replace(/^- [^:]+: /, '');
    const fixed = fixDwsChatMessageSendShellScript(command);
    expect(fixed).toContain("$'");
    expect(fixed).not.toMatch(/--text\s+"[^"]*\\n/);
  });
});

describe('artifact URL normalization', () => {
  const RAW = 'https://sto.example.com/artifacts/总部结算对账分析_日_20260708_1726.html';
  const SINGLE = 'https://sto.example.com/artifacts/%E6%80%BB%E9%83%A8%E7%BB%93%E7%AE%97%E5%AF%B9%E8%B4%A6%E5%88%86%E6%9E%90_%E6%97%A5_20260708_1726.html';
  // 把单次编码里每个 `%` 再编码成 `%25`，模拟上游错误地 encodeURIComponent 一次
  const DOUBLE = SINGLE.replace(/%/g, '%25');

  it('encodeURI is idempotent on already-single-encoded URL (no double-encoding)', () => {
    expect(normalizeArtifactUrl(SINGLE)).toBe(SINGLE);
  });

  it('raw CJK url is encoded exactly once', () => {
    expect(normalizeArtifactUrl(RAW)).toBe(SINGLE);
  });

  it('double-encoded URL collapses back to single encoding', () => {
    expect(normalizeArtifactUrl(DOUBLE)).toBe(SINGLE);
  });

  it('is idempotent across states (call twice == call once)', () => {
    expect(normalizeArtifactUrl(normalizeArtifactUrl(RAW))).toBe(normalizeArtifactUrl(RAW));
    expect(normalizeArtifactUrl(normalizeArtifactUrl(DOUBLE))).toBe(SINGLE);
  });

  it('non-url / non-http string is returned untouched', () => {
    expect(normalizeArtifactUrl('')).toBe('');
    expect(normalizeArtifactUrl('ftp://x/中')).toBe('ftp://x/中');
    expect(normalizeArtifactUrl('plain text 没有 url')).toBe('plain text 没有 url');
  });

  it('normalizeDwsChatMessageSendText (shared) normalizes embedded url regardless of input state', () => {
    const withRaw = `- 产物：${RAW}`;
    const withDouble = `- 产物：${DOUBLE}`;
    const expected = `- 产物：${SINGLE}`;
    expect(normalizeDwsChatMessageSendText(withRaw)).toContain(expected);
    expect(normalizeDwsChatMessageSendText(withDouble)).toContain(expected);
    // 双重编码必须被消除
    expect(normalizeDwsChatMessageSendText(withDouble)).not.toContain('%25');
  });

  it('plugin copy: normalizeDwsChatMessageSendText normalizes embedded url the same way', () => {
    const withDouble = `- 产物：${DOUBLE}`;
    expect(pluginNormalize(withDouble)).toContain(`- 产物：${SINGLE}`);
    expect(pluginNormalize(withDouble)).not.toContain('%25');
  });

  it('watchdog-style "label：url" bullet stays single-encoded after argv normalization', () => {
    const argv = extractNormalizedDwsSendArgv(
      `dws chat message send --text "- 产物：${DOUBLE}"`,
    );
    const text = argv?.[argv.indexOf('--text') + 1] as string;
    expect(text).toContain(`- 产物：${SINGLE}`);
    expect(text).not.toContain('%25');
  });

  // 下载密钥类 query：`+` `/` `=` 常被 encodeURIComponent 成 `%2B` `%2F` `%3D`；
  // decodeURI 不会解开它们，旧逻辑再 encodeURI 会打成 `%252B` 导致链接失效。
  const KEY_RAW =
    'https://wd-vipn.sto.cn/anonymous/ai/claw/shop/stock/download?key=OsSP5xLkfYMYQrGJLKY+ime/iuLkWJfeISMm99bWEml4KSkluwx+KFk0blJFn8Cmzf4XNnjLeUgmvP4leTOzL439Hibp4hmlGWrlpMygjQzlRKy295aAO53t0Vx5jcbmM6s4SMsyC0gOFWb66hnr9B551ydagHZMlqI4V2l39ofSEHfEmp/2ElZLCSxXSQr8uq5tT4PqNKB0yLpoq0s2dQ==';
  const KEY_SINGLE =
    'https://wd-vipn.sto.cn/anonymous/ai/claw/shop/stock/download?key=OsSP5xLkfYMYQrGJLKY%2Bime%2FiuLkWJfeISMm99bWEml4KSkluwx%2BKFk0blJFn8Cmzf4XNnjLeUgmvP4leTOzL439Hibp4hmlGWrlpMygjQzlRKy295aAO53t0Vx5jcbmM6s4SMsyC0gOFWb66hnr9B551ydagHZMlqI4V2l39ofSEHfEmp%2F2ElZLCSxXSQr8uq5tT4PqNKB0yLpoq0s2dQ%3D%3D';
  const KEY_DOUBLE = KEY_SINGLE.replace(/%/g, '%25');

  it('query reserved escapes (%2B/%2F/%3D) stay single-encoded (idempotent)', () => {
    expect(normalizeArtifactUrl(KEY_SINGLE)).toBe(KEY_SINGLE);
    expect(normalizeArtifactUrl(KEY_SINGLE)).not.toContain('%25');
  });

  it('double-encoded query reserved escapes collapse to single encoding', () => {
    expect(normalizeArtifactUrl(KEY_DOUBLE)).toBe(KEY_SINGLE);
    expect(normalizeArtifactUrl(KEY_DOUBLE)).not.toContain('%252B');
    expect(normalizeArtifactUrl(KEY_DOUBLE)).not.toContain('%252F');
    expect(normalizeArtifactUrl(KEY_DOUBLE)).not.toContain('%253D');
  });

  it('raw +/=/ in query are left usable (encodeURI does not force %2B)', () => {
    expect(normalizeArtifactUrl(KEY_RAW)).toBe(KEY_RAW);
  });

  it('normalizeDwsChatMessageSendText collapses double-encoded download key urls', () => {
    const body = `报表下载：${KEY_DOUBLE}`;
    const normalized = normalizeDwsChatMessageSendText(body);
    expect(normalized).toContain(KEY_SINGLE);
    expect(normalized).not.toContain('%252B');
  });
});

describe('local artifact path detection in dws --text', () => {
  it('detects file://, .claw-output and bare absolute artifact paths', () => {
    expect(textContainsLocalArtifactPath('file:///Users/a/.claw-output/a.html')).toBe(true);
    expect(
      textContainsLocalArtifactPath(
        '报告：/Users/yaolei/.stoclaw/workspace/.claw-output/客户异常监控20260724_151406.html',
      ),
    ).toBe(true);
    expect(textContainsLocalArtifactPath('见 /Users/yaolei/Desktop/report.html')).toBe(true);
    expect(textContainsLocalArtifactPath('C:\\Users\\sto\\.claw-output\\r.html')).toBe(true);
    expect(textContainsLocalArtifactPath('周报：https://example.com/r.html')).toBe(false);
    expect(textContainsLocalArtifactPath('纯文字无路径')).toBe(false);
  });

  it('only inspects --text bodies so drive upload --file does not false-positive', () => {
    const clean =
      'dws drive upload --file /Users/yaolei/.claw-output/report.html -y --format json && dws chat message send --user u1 --text "周报已上传" --format json';
    expect(dwsChatMessageSendTextContainsLocalArtifactPath(clean)).toBe(false);

    const dirty =
      'dws chat message send --user u1 --text "报告：/Users/yaolei/.stoclaw/workspace/.claw-output/x.html" --format json';
    expect(dwsChatMessageSendTextContainsLocalArtifactPath(dirty)).toBe(true);
  });
});
