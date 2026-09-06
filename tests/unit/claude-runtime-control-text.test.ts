import { describe, expect, it } from 'vitest';
import { isClaudeRuntimeControlText } from '../../shared/claude-runtime-control-text';

describe('isClaudeRuntimeControlText', () => {
  it.each([
    '<local-command-caveat>Local command</local-command-caveat>',
    '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>',
    '<local-command-stdout>Compacted</local-command-stdout>',
    'This session is being continued from a previous conversation that ran out of context.\n\nSummary:',
  ])('recognizes Claude compact control text', (text) => {
    expect(isClaudeRuntimeControlText(text)).toBe(true);
  });

  it('keeps normal user content visible', () => {
    expect(isClaudeRuntimeControlText('请帮我压缩这段普通文本')).toBe(false);
  });
});
