import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_THINKING_PREVIEW_CHARS,
  extractCollapsedThinkingPreview,
  lastThinkingContent,
  resolveCollapsedLivePreview,
} from '@/pages/Chat/thinking/collapsed-thinking-preview';

describe('extractCollapsedThinkingPreview', () => {
  it('returns the last sentence', () => {
    expect(extractCollapsedThinkingPreview('先看结构。正在核对首页搜索框的字段名。')).toBe(
      '正在核对首页搜索框的字段名。',
    );
  });

  it('takes the tail of a long sentence so streaming stays current', () => {
    const last = `${'字'.repeat(COLLAPSED_THINKING_PREVIEW_CHARS + 8)}。`;
    const preview = extractCollapsedThinkingPreview(`前文。${last}`);
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.endsWith('。')).toBe(true);
    expect(preview.length).toBe(COLLAPSED_THINKING_PREVIEW_CHARS + 1);
  });

  it('collapses whitespace', () => {
    expect(extractCollapsedThinkingPreview('  准备改\nHeader  ')).toBe('准备改 Header');
  });
});

describe('resolveCollapsedLivePreview', () => {
  it('uses tool display name while a tool is running', () => {
    expect(resolveCollapsedLivePreview({
      activity: { kind: 'tool', name: 'read_file' },
      timeline: [{ type: 'thinking', content: '先思考' }],
      toolDisplayName: '读文件',
    })).toBe('读文件');
  });

  it('uses the latest thinking sentence otherwise', () => {
    expect(resolveCollapsedLivePreview({
      activity: { kind: 'thinking' },
      timeline: [
        { type: 'thinking', content: '第一步。' },
        { type: 'thinking', content: '正在核对字段名。' },
      ],
    })).toBe('正在核对字段名。');
  });

  it('falls back to phase text', () => {
    expect(resolveCollapsedLivePreview({
      activity: { kind: 'thinking' },
      timeline: [],
      phaseText: '先看项目结构。',
    })).toBe('先看项目结构。');
  });
});

describe('lastThinkingContent', () => {
  it('returns the last thinking block', () => {
    expect(lastThinkingContent([
      { type: 'thinking', content: '甲' },
      { type: 'tool', index: 0, id: 't1', name: 'read', input: {} },
      { type: 'thinking', content: '乙' },
    ])).toBe('乙');
  });

  it('reads the tail from live parts without joining the full rope', () => {
    const content = lastThinkingContent([
      { type: 'thinking', content: '旧', liveParts: [`${'前'.repeat(80)}。`, '正在核对字段名。'] },
    ]);
    expect(content.endsWith('正在核对字段名。')).toBe(true);
    expect(content.length).toBeLessThanOrEqual(96);
  });
});
