import { describe, expect, it } from 'vitest';
import { mergePiDefaultContext } from '@electron/services/pi-context-sync';

const oldDefault = [
  '<!-- stoclaw:pi:begin -->',
  '# Old Pi Context',
  '<!-- stoclaw:pi:end -->',
].join('\n');

const newDefault = [
  '<!-- stoclaw:pi:begin -->',
  '# New Pi Context',
  'Use the managed Pi runtime.',
  '<!-- stoclaw:pi:end -->',
].join('\n');

describe('mergePiDefaultContext', () => {
  it('creates a new managed Pi AGENTS.md', () => {
    expect(mergePiDefaultContext(null, newDefault)).toBe(`${newDefault}\n`);
  });

  it('preserves existing user content', () => {
    const merged = mergePiDefaultContext('# User Rules\nKeep this.', newDefault);
    expect(merged).toBe(`# User Rules\nKeep this.\n\n${newDefault}\n`);
  });

  it('updates the managed section in place', () => {
    const existing = `# User Rules\n\n${oldDefault}\n\n## Personal Notes\nKeep this too.`;
    const merged = mergePiDefaultContext(existing, newDefault);
    expect(merged).toBe(`# User Rules\n\n${newDefault}\n\n## Personal Notes\nKeep this too.\n`);
  });

  it('wraps an unmarked bundled context', () => {
    expect(mergePiDefaultContext('', '# Plain Pi Default')).toBe(
      '<!-- stoclaw:pi:begin -->\n# Plain Pi Default\n<!-- stoclaw:pi:end -->\n',
    );
  });
});
