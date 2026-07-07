import { describe, expect, it } from 'vitest';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';
import {
  applyTextOwnershipToParsedTurn,
  classifyTextOverlap,
  normalizeDisplayTextForOwnership,
  processSegmentsCoverText,
  textsAreOwnershipDuplicates,
} from '@/pages/Chat/thinking/text-ownership';

describe('TextOwnership', () => {
  it('treats whitespace and colon variants as duplicates', () => {
    expect(
      textsAreOwnershipDuplicates(
        '这是答复内容。',
        '这是答复内容。',
      ),
    ).toBe(true);
    expect(
      textsAreOwnershipDuplicates(
        '步骤一：查询数据',
        '步骤一: 查询数据',
      ),
    ).toBe(true);
  });

  it('does not treat different batch narrations as duplicates', () => {
    expect(
      textsAreOwnershipDuplicates(
        '让我搜索模板',
        '让我查询指标',
      ),
    ).toBe(false);
  });

  it('detects final as prefix of longer process text (streaming early)', () => {
    const processLong =
      '我来帮你实现客户异常监控功能。为了更好地满足你的需求，我需要了解几个关键信息：数据源、阈值、通知方式。';
    const finalPrefix =
      '我来帮你实现客户异常监控功能。为了更好地满足你的需求，我需要了解几个关键信息：数据源、';
    expect(classifyTextOverlap(processLong, finalPrefix)).toBe('final_prefix_of_process');

    const layout = applyTextOwnershipToParsedTurn(
      {
        segments: [
          { kind: 'phase-text', key: 'phase-text-0', text: processLong },
        ],
        finalReplyText: finalPrefix,
      },
      { isLiveStream: true },
    );

    expect(layout.finalReplyText).toBeNull();
    expect(layout.segments).toHaveLength(1);
  });

  it('removes process prefix when final is the complete deliverable', () => {
    const processPrefix = '我来帮你实现客户异常监控功能。为了更好地满足你的需求，';
    const finalFull =
      '我来帮你实现客户异常监控功能。为了更好地满足你的需求，我需要了解几个关键信息：数据源、阈值。';
    expect(classifyTextOverlap(processPrefix, finalFull)).toBe('process_prefix_of_final');

    const layout = applyTextOwnershipToParsedTurn(
      {
        segments: [
          { kind: 'phase-text', key: 'phase-text-0', text: processPrefix },
        ],
        finalReplyText: finalFull,
      },
      { isLiveStream: false },
    );

    expect(layout.finalReplyText).toBe(finalFull);
    expect(layout.segments.some((s) => s.kind === 'phase-text')).toBe(false);
  });

  it('removes phase-text when final reply is the same deliverable', () => {
    const duplicate = '## 周报\n\n本周指标如下。';
    const layout = applyTextOwnershipToParsedTurn({
      segments: [
        { kind: 'phase-text', key: 'phase-text-after-0', text: duplicate },
        {
          kind: 'tool-group',
          key: 'group-0',
          timeline: [],
          state: 'completed',
        },
      ],
      finalReplyText: duplicate,
    });

    expect(layout.finalReplyText).toBe(duplicate);
    expect(layout.segments.some((s) => s.kind === 'phase-text')).toBe(false);
  });

  it('dedupes timeline thinking text against final reply', () => {
    const duplicate = '这是思考区 timeline 里的一段长旁白，与正文完全重复的内容块。';
    const layout = applyTextOwnershipToParsedTurn({
      segments: [
        {
          kind: 'tool-group',
          key: 'group-0',
          timeline: [{ type: 'thinking', content: duplicate }],
          state: 'completed',
        },
      ],
      finalReplyText: duplicate,
    });

    expect(layout.finalReplyText).toBe(duplicate);
    const group = layout.segments.find((s) => s.kind === 'tool-group');
    expect(group?.kind === 'tool-group' ? group.timeline : []).toHaveLength(0);
  });

  it('keeps planning narration in process only', () => {
    const narration = 'Now let me query the database.';
    const layout = applyTextOwnershipToParsedTurn({
      segments: [
        { kind: 'phase-text', key: 'phase-text-0', text: narration },
      ],
      finalReplyText: narration,
    });

    expect(layout.finalReplyText).toBeNull();
    expect(layout.segments).toHaveLength(1);
  });

  it('processSegmentsCoverText detects overlap for UI fallback', () => {
    const narration = '让我查看支持全国维度的增量成本查询命令：';
    const segments = [
      { kind: 'phase-text' as const, key: 'phase-text-0', text: narration },
    ];
    expect(processSegmentsCoverText(segments, narration)).toBe(true);
    expect(processSegmentsCoverText(segments, '完全不同的正文')).toBe(false);
  });

  it('parseThinkingTurnLayout applies ownership on duplicate final', () => {
    const text = '最终答复只有这一段。';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text },
        ],
      },
    ];
    const parsed = parseThinkingTurnLayout(messages, { isLiveStream: false });
    const phaseCount = parsed.segments.filter((s) => s.kind === 'phase-text').length;
    if (parsed.finalReplyText) {
      expect(phaseCount).toBe(0);
    }
    expect(normalizeDisplayTextForOwnership(text).length).toBeGreaterThan(0);
  });
});
