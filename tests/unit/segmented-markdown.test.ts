import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdown } from '../../src/pages/Chat/segmented-markdown';

describe('splitStreamingMarkdown', () => {
  it('no paragraph break → all tail', () => {
    expect(splitStreamingMarkdown('hello world')).toEqual({
      sealed: [],
      tail: 'hello world',
    });
  });

  it('seals completed paragraphs and keeps growing tail', () => {
    const first = splitStreamingMarkdown('para one\n\npara two start');
    expect(first.sealed).toEqual(['para one']);
    expect(first.tail).toBe('para two start');

    const second = splitStreamingMarkdown('para one\n\npara two start more');
    expect(second.sealed).toEqual(['para one']);
    expect(second.tail).toBe('para two start more');
  });

  it('does not split on blank lines inside fences', () => {
    const text = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nout';
    const result = splitStreamingMarkdown(text);
    expect(result.sealed.join('\n\n')).toContain('```js');
    expect(result.tail).toBe('out');
  });
});
