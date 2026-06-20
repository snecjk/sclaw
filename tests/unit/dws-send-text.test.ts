import { describe, expect, it } from 'vitest';
import { appendDingTalkAgentSendDisclaimer } from '../../shared/dingtalk-disclaimer';
import { buildDingTalkMentionSystemContext } from '../../shared/dingtalk-mention-context';
import {
  buildDwsChatMessageSendAgentCommandExample,
  fixDwsChatMessageSendShellScript,
  fixDwsChatMessageSendToolParams,
  normalizeDwsChatMessageSendText,
} from '../../shared/dws-send-text';
import {
  normalizeDwsChatMessageSendText as pluginNormalize,
} from '../../sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dws-send-text';

const cmd =
  'dws chat message send --user u1 --title "消息" --text "### 标题\\n\\n- **早上**：多云\\n\\n---\\n\\n> *本消息由 STO Claw 代为发送，非本人实时回复。*" --format json';

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

  it('fixDwsChatMessageSendToolParams rewrites exec tool command on non-win32', () => {
    if (process.platform === 'win32') return;

    const params = { command: cmd };
    const fixed = fixDwsChatMessageSendToolParams(params);
    expect(fixed?.command).toContain("$'");
    expect(fixed?.command).not.toMatch(/--text\s+"[^"]*\\n/);
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
