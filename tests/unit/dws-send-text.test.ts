import { describe, expect, it, vi } from 'vitest';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-disclaimer';
import { buildDingTalkMentionSystemContext } from '../../shared/dingtalk-mention-context';
import {
  buildDwsChatMessageSendAgentCommandExample,
  buildWin32DirectDwsExecNodeCommand,
  extractNormalizedDwsSendArgv,
  fixDwsChatMessageSendShellScript,
  fixDwsChatMessageSendToolParams,
  fixDwsChatMessageSendToolParamsForOpenClawExec,
  normalizeDwsChatMessageSendText,
  parseDwsChatMessageSendShellCommandArgs,
  rewriteDwsSendSpawnInvocation,
  shellQuoteDwsSendTextForPowerShell,
  tryParseDwsSendExecInvocation,
} from '../../shared/dws-send-text';
import {
  normalizeDwsChatMessageSendText as pluginNormalize,
} from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dws-send-text';

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
    ]);
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
