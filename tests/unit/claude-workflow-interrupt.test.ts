import { describe, expect, it } from 'vitest';
import { mergeSegmentsMonotonic } from '@/pages/Chat/thinking/segment-merge';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';

describe('Claude workflow interrupt phase-text', () => {
  const interrupt = '正在拉取工作流参数表单。';
  const messages = [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '找模板' },
        { type: 'thinking', thinking: '确认 schema' },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '找模板' },
        { type: 'thinking', thinking: '确认 schema' },
        { type: 'tool_use', id: 't1', name: 'search', input: {} },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: interrupt }],
    },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'search', input: {} },
        { type: 'tool_use', id: 't2', name: 'get_workflow_schema', input: {} },
      ],
    },
  ];

  const modes = [
    { label: 'live-claude', isLiveStream: true, engineProfile: 'claude' as const },
    { label: 'done-claude', isLiveStream: false, engineProfile: 'claude' as const },
    { label: 'live-infer', isLiveStream: true },
    { label: 'done-infer', isLiveStream: false },
  ];

  for (const mode of modes) {
    it(`shows interrupt between summaries (${mode.label})`, () => {
      const layout = parseThinkingTurnLayout(messages, mode);
      const between = layout.segments.find(
        (segment, index) =>
          segment.kind === 'phase-text'
          && layout.segments[index - 1]?.kind === 'tool-group'
          && layout.segments[index + 1]?.kind === 'tool-group',
      );
      expect(
        between,
        JSON.stringify(
          layout.segments.map((segment) =>
            segment.kind === 'phase-text' ? `phase:${segment.text.slice(0, 20)}` : segment.kind,
          ),
        ),
      ).toMatchObject({ kind: 'phase-text', text: interrupt });
    });
  }

  it('mergeSegmentsMonotonic keeps phase between cached tool-groups (live sticky cache)', () => {
    const cached = parseThinkingTurnLayout(messages.slice(0, 3) as never, {
      isLiveStream: true,
      engineProfile: 'claude',
    }).segments;
    const incoming = parseThinkingTurnLayout(messages, {
      isLiveStream: true,
      engineProfile: 'claude',
    }).segments;

    const merged = mergeSegmentsMonotonic(cached, incoming);
    const between = merged.find(
      (segment, index) =>
        segment.kind === 'phase-text'
        && merged[index - 1]?.kind === 'tool-group'
        && merged[index + 1]?.kind === 'tool-group',
    );
    expect(between).toMatchObject({ kind: 'phase-text', text: interrupt });
  });
});
