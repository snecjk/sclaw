import { describe, expect, it } from 'vitest';
import { mergeClaudeDefaultContext } from '@electron/services/claude-context-sync';

const oldDefault = [
  '<!-- stoclaw:begin -->',
  '# Old StoClaw Context',
  '<!-- stoclaw:end -->',
].join('\n');

const newDefault = [
  '<!-- stoclaw:begin -->',
  '# New StoClaw Context',
  'Use the managed workspace.',
  '<!-- stoclaw:end -->',
].join('\n');

describe('mergeClaudeDefaultContext', () => {
  it('creates a new CLAUDE.md from the default context', () => {
    expect(mergeClaudeDefaultContext(null, newDefault)).toBe(`${newDefault}\n`);
  });

  it('appends the default context while preserving existing user content', () => {
    const merged = mergeClaudeDefaultContext('# User Rules\nKeep this.', newDefault);

    expect(merged).toBe(`# User Rules\nKeep this.\n\n${newDefault}\n`);
  });

  it('updates an existing StoClaw-managed section in place', () => {
    const existing = `# User Rules\n\n${oldDefault}\n\n## Personal Notes\nKeep this too.`;
    const merged = mergeClaudeDefaultContext(existing, newDefault);

    expect(merged).toBe(`# User Rules\n\n${newDefault}\n\n## Personal Notes\nKeep this too.\n`);
  });

  it('wraps default context when the source is missing markers', () => {
    const merged = mergeClaudeDefaultContext('', '# Plain Default');

    expect(merged).toBe('<!-- stoclaw:begin -->\n# Plain Default\n<!-- stoclaw:end -->\n');
  });
});
