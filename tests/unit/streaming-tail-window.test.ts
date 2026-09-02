import { describe, expect, it } from 'vitest';
import {
  STREAMING_THINKING_TAIL_WINDOW_CHARS,
  sliceStreamingThinkingTail,
} from '@/pages/Chat/thinking/streaming-tail-window';

describe('sliceStreamingThinkingTail', () => {
  it('未超阈值时原样返回', () => {
    const content = '短思考内容';
    expect(sliceStreamingThinkingTail(content)).toEqual({ text: content, omittedChars: 0 });
  });

  it('恰好等于阈值时不截断', () => {
    const content = 'a'.repeat(STREAMING_THINKING_TAIL_WINDOW_CHARS);
    expect(sliceStreamingThinkingTail(content)).toEqual({ text: content, omittedChars: 0 });
  });

  it('超阈值 1 字时只保留尾部窗口并报告省略字数', () => {
    const content = `头${'a'.repeat(STREAMING_THINKING_TAIL_WINDOW_CHARS)}`;
    const result = sliceStreamingThinkingTail(content);
    expect(result.omittedChars).toBe(1);
    expect(result.text).toBe('a'.repeat(STREAMING_THINKING_TAIL_WINDOW_CHARS));
    expect(result.text.length).toBe(STREAMING_THINKING_TAIL_WINDOW_CHARS);
  });

  it('超长内容省略字数正确且窗口取尾部', () => {
    const content = `${'头'.repeat(500)}${'尾'.repeat(STREAMING_THINKING_TAIL_WINDOW_CHARS)}`;
    const result = sliceStreamingThinkingTail(content);
    expect(result.omittedChars).toBe(500);
    expect(result.text).toBe('尾'.repeat(STREAMING_THINKING_TAIL_WINDOW_CHARS));
  });

  it('空字符串原样返回', () => {
    expect(sliceStreamingThinkingTail('')).toEqual({ text: '', omittedChars: 0 });
  });
});
