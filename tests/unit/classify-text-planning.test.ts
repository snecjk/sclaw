import { describe, expect, it } from 'vitest';
import { parseThinkingTurnLayout } from '@/pages/Chat/thinking-turn-segments';
import {
  dedupePhaseTextsAgainstFinalReply,
  isLikelyPlanningNarration,
  isLikelyUserClarificationReply,
  shouldPromoteTextToFinalReply,
} from '@/pages/Chat/thinking/classify-text';

describe('isLikelyUserClarificationReply', () => {
  const clarification =
    '好的，客户发件总部科目成本查询。还需要确认两个信息：\n\n查询月份：哪个月？（格式如 202606）\n导出类型：合计金额 还是 单票金额？';

  it('detects parameter confirmation prompts', () => {
    expect(isLikelyUserClarificationReply(clarification)).toBe(true);
    expect(isLikelyUserClarificationReply('请提供查询月份')).toBe(true);
    expect(isLikelyUserClarificationReply('需要您确认导出类型：合计还是单票？')).toBe(true);
  });

  it('does not treat tool-planning narration as clarification', () => {
    expect(isLikelyUserClarificationReply('让我查看支持全国维度的增量成本查询命令：')).toBe(false);
    expect(isLikelyUserClarificationReply('先搜索匹配的命令：')).toBe(false);
  });

  it('detects intermediate clarification chain phrases', () => {
    expect(
      isLikelyUserClarificationReply(
        '我来帮您查询客户发件总部科目成本，还需要确认几个参数：',
      ),
    ).toBe(true);
    expect(
      isLikelyUserClarificationReply(
        '好的，维度确认为客户发件总部成本，还需要确认两个参数：',
      ),
    ).toBe(true);
    expect(
      isLikelyUserClarificationReply(
        '好的，维度为客户发件总部成本。请补充以下两个信息：\n\n查询月份：例如 202606',
      ),
    ).toBe(true);
  });
});

describe('isLikelyPlanningNarration (English)', () => {
  it('treats short English tool-planning as narration', () => {
    expect(isLikelyPlanningNarration('Now let me query the latest metrics.')).toBe(true);
    expect(isLikelyPlanningNarration('Let me search for a relevant skill.')).toBe(true);
    expect(isLikelyPlanningNarration("I'll check the workflow template first.")).toBe(true);
  });

  it('does not treat deliverable markdown as planning', () => {
    const table = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |';
    expect(isLikelyPlanningNarration(table)).toBe(false);
  });
});

describe('isLikelyPlanningNarration (Chinese tool planning)', () => {
  it('treats tool lookup narration as planning', () => {
    expect(isLikelyPlanningNarration('让我查看支持全国维度的增量成本查询命令：')).toBe(true);
    expect(isLikelyPlanningNarration('先搜索匹配的命令：')).toBe(true);
    expect(isLikelyPlanningNarration('找到相关命令，让我查看详细的参数说明：')).toBe(true);
  });

  it('does not treat user clarification as planning', () => {
    const clarification =
      '好的，客户发件总部科目成本查询。还需要确认两个信息：\n\n查询月份：哪个月？（格式如 202606）\n导出类型：合计金额 还是 单票金额？';
    expect(isLikelyPlanningNarration(clarification)).toBe(false);
  });
});

describe('shouldPromoteTextToFinalReply', () => {
  it('promotes trailing clarification as final reply when done', () => {
    const clarification =
      '好的，客户发件总部科目成本查询。还需要确认两个信息：\n\n查询月份：哪个月？（格式如 202606）\n导出类型：合计金额 还是 单票金额？';
    expect(
      shouldPromoteTextToFinalReply(clarification, false, 2, 2, false),
    ).toBe(true);
  });

  it('does not promote clarification when more tools follow', () => {
    const clarification = '还需要确认两个信息：查询月份是哪个月？';
    expect(
      shouldPromoteTextToFinalReply(clarification, false, 1, 2, true),
    ).toBe(false);
  });

  it('does not promote English planning during live stream', () => {
    const text = 'Now let me query the database for last week.';
    expect(
      shouldPromoteTextToFinalReply(text, true, 0, 0, false),
    ).toBe(false);
  });
});

describe('parseThinkingTurnLayout text ownership (acceptance)', () => {
  it('clarification reply promotes to final only, not duplicate phase-text', () => {
    const clarification =
      '好的，客户发件总部科目成本查询。还需要确认两个信息：\n\n查询月份：哪个月？（格式如 202606）\n导出类型：合计金额 还是 单票金额？';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '确认参数' },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'text', text: clarification },
        ],
      },
    ];
    const layout = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(layout.finalReplyText?.trim()).toBe(clarification);
    const phaseTexts = layout.segments
      .filter((s) => s.kind === 'phase-text')
      .map((s) => s.text.trim());
    expect(phaseTexts.some((t) => t.includes('还需要确认两个信息'))).toBe(false);
  });

  it('tool planning narration stays in process, not final reply', () => {
    const narration = '让我查看支持全国维度的增量成本查询命令：';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: narration },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
        ],
      },
    ];
    const layout = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(layout.finalReplyText).toBeNull();
    expect(
      layout.segments.some(
        (s) => s.kind === 'phase-text' && s.text.includes('让我查看'),
      ),
    ).toBe(true);
  });

  it('ordinary deliverable reply becomes final reply', () => {
    const reply = '查询完成，202606 单票金额数据如下：\n\n| 日期 | 金额 |';
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
      },
    ];
    const layout = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(layout.finalReplyText?.trim()).toBe(reply);
  });

  it('strips clarification chain phase-texts when final is clarification', () => {
    const phaseEarly = '我来帮您查询客户发件总部科目成本，还需要确认几个参数：';
    const phaseMid = '好的，维度确认为客户发件总部成本，还需要确认两个参数：';
    const finalReply =
      '好的，维度为客户发件总部成本。请补充以下两个信息：\n\n查询月份：例如 202606\n导出类型：选 合计金额 还是 单票金额？';
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: phaseEarly },
          { type: 'tool_use', id: 't1', name: 'search', input: {} },
          { type: 'text', text: phaseMid },
          { type: 'tool_use', id: 't2', name: 'help', input: {} },
          { type: 'text', text: finalReply },
        ],
      },
    ];
    const layout = parseThinkingTurnLayout(messages, { isLiveStream: false });
    expect(layout.finalReplyText?.trim()).toBe(finalReply);
    const phaseTexts = layout.segments
      .filter((s) => s.kind === 'phase-text')
      .map((s) => s.text.trim());
    expect(phaseTexts.some((t) => t.includes('还需要确认几个参数'))).toBe(false);
    expect(phaseTexts.some((t) => t.includes('还需要确认两个参数'))).toBe(false);
  });
});

describe('dedupePhaseTextsAgainstFinalReply (clarification intent)', () => {
  it('removes all clarification phase-texts when final is clarification', () => {
    const segments = [
      {
        kind: 'phase-text' as const,
        key: 'phase-0',
        text: '我来帮您查询客户发件总部科目成本，还需要确认几个参数：',
      },
      {
        kind: 'tool-group' as const,
        key: 'group-0',
        timeline: [],
        state: 'completed' as const,
      },
      {
        kind: 'phase-text' as const,
        key: 'phase-1',
        text: '好的，维度确认为客户发件总部成本，还需要确认两个参数：',
      },
    ];
    const finalReply =
      '好的，维度为客户发件总部成本。请补充以下两个信息：\n\n查询月份：例如 202606';
    dedupePhaseTextsAgainstFinalReply(segments, finalReply);
    expect(segments.filter((s) => s.kind === 'phase-text')).toHaveLength(0);
  });
});
