import { describe, expect, it } from 'vitest';
import {
  extractText,
  extractThinkingTimeline,
  isWorkflowCompletionTranscript,
  stripDwsSendMetadataForDisplay,
} from '../../src/pages/Chat/message-utils';
import {
  LIVE_BLOCK_INDEX_KEY,
  LIVE_FIELD_KEY,
  LIVE_PARTS_KEY,
  LIVE_TAIL_KEY,
  liveTextTail,
} from '../../shared/chat-live-append';

describe('message display sanitize', () => {
  it('removes task id suffix from assistant confirmation', () => {
    const input = '✅ 已将《月》这首诗发送给 **谷研硕**，**任务 ID：HnVhhJpuIlDIhATK8U016j9E4v0kFBju3E0a7w8KQoQ=**';
    expect(stripDwsSendMetadataForDisplay(input)).toBe('✅ 已将《月》这首诗发送给 **谷研硕**');
  });

  it('removes comma-separated task id without bold', () => {
    const input =
      '✅ 已将《月》这首诗发送给 **李峥**, 任务 ID: qxWlh4mus0ApRwHKyj0IGVw2W6zQndUjMAnhnNpvaj8=';
    expect(stripDwsSendMetadataForDisplay(input)).toBe('✅ 已将《月》这首诗发送给 **李峥**');
  });

  it('removes standalone task id line', () => {
    const input = '文件已发送。\n任务 ID: i7GyeC/gtWaof6h9G1T8onBD15N0DniCB5My28pbIPk=\n群成员可见附件。';
    expect(stripDwsSendMetadataForDisplay(input)).toBe('文件已发送。\n群成员可见附件。');
  });

  it('strips task id from assistant text blocks via extractText', () => {
    const input =
      '✅ 已将《月》这首诗发送给 **李峥**, 任务 ID: qxWlh4mus0ApRwHKyj0IGVw2W6zQndUjMAnhnNpvaj8=';
    expect(extractText({ role: 'assistant', content: input })).toBe('✅ 已将《月》这首诗发送给 **李峥**');
  });

  it('strips Gateway timestamp prefix from user messages', () => {
    const input = '[Wed 2026-06-10 11:33 GMT+8] 安装';
    expect(extractText({ role: 'user', content: input })).toBe('安装');
  });

  it('strips Gateway timestamp prefix regardless of user role casing', () => {
    const input = '[Wed 2026-06-10 11:33 GMT+8] hello';
    expect(extractText({ role: 'User', content: input })).toBe('hello');
  });

  it('preserves trailing commas inside fenced sql blocks', () => {
    const input = '```sql\nCREATE TABLE t (\n  `id` BIGINT NOT NULL,\n  `name` VARCHAR(64)\n);\n```';
    expect(stripDwsSendMetadataForDisplay(input)).toBe(input);
  });

  it('preserves trailing commas inside inline code', () => {
    const input = 'Run `SELECT a, FROM t` to test';
    expect(stripDwsSendMetadataForDisplay(input)).toBe(input);
  });

  it('still strips trailing comma before newline in plain prose', () => {
    const input = '已发送给 **李峥**，\n下一条消息';
    expect(stripDwsSendMetadataForDisplay(input)).toBe('已发送给 **李峥**\n下一条消息');
  });

  it('strips task id from thinking timeline process messages', () => {
    const input =
      '✅ 已将《月》这首诗发送给 **李峥**, 任务 ID: qxWlh4mus0ApRwHKyj0IGVw2W6zQndUjMAnhnNpvaj8=';
    const timeline = extractThinkingTimeline({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: input }],
    });
    expect(timeline[0]?.type).toBe('thinking');
    if (timeline[0]?.type === 'thinking') {
      expect(timeline[0].content).toBe('✅ 已将《月》这首诗发送给 **李峥**');
    }
  });
});

describe('workflow completion transcript detection', () => {
  it('recognizes legacy Markdown completion reports so the workflow card owns artifact display', () => {
    expect(isWorkflowCompletionTranscript(
      '✅ 工作流【盖亚 v3】已执行完成！\n\n执行状态：\n运行 ID：run_203443162047086592\n状态：✅ 成功\n\n生成产物：\nscience_knowledge.html\n预览链接',
    )).toBe(true);
  });

  it('does not hide ordinary assistant text that merely mentions a run id', () => {
    expect(isWorkflowCompletionTranscript('我会继续检查 run_203443162047086592 的配置。')).toBe(false);
  });
});

describe('extractText live append', () => {
  const fullReply = [
    '| 日期 | 最高 / 最低 | 降水 | 风速 |',
    '| --- | --- | --- | --- |',
    '| 09-03 | 30.5 / 25.1 | 4.3 | 17.2 |',
    '| 09-04 | 30.7 / 25.4 | 2.9 | 17.4 |',
    '| 09-05 | 30.7 / 24.1 | 1.2 | 16.8 |',
    '明天起转多云到晴。',
  ].join('\n');

  it('joins live parts for string content instead of the 96-char preview tail', () => {
    expect(fullReply.length).toBeGreaterThan(96);
    const message = {
      role: 'assistant',
      content: fullReply.slice(0, 12),
      _liveParts: [fullReply.slice(0, 80), fullReply.slice(80)],
      _liveField: 'content',
      _liveBlockIndex: null,
      _liveTail: fullReply.slice(-96),
    };
    expect(extractText(message)).toBe(fullReply);
    expect(extractText(message)).not.toBe(fullReply.slice(-96));
  });

  it('joins live parts for a growing text block instead of the seed or preview tail', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me build the reply.' },
        { type: 'text', text: '| 日期 |' },
      ],
      _liveParts: [fullReply],
      _liveField: 'text',
      _liveBlockIndex: 1,
      _liveTail: fullReply.slice(-96),
    };
    expect(extractText(message)).toBe(fullReply);
    expect(extractText(message).length).toBeGreaterThan(96);
  });
});

describe('live overlay body text', () => {
  const fullReply = [
    '| 日期 | 高温 / 低温 | 降水 | 风速 |',
    '| --- | --- | --- | --- |',
    '| 09-03 | 30.5 / 25.1 | 4.3 | 17.2 |',
    '| 09-04 | 30.7 / 25.4 | 2.9 | 17.4 |',
    '| 09-05 | 30.7 / 24.1 | 1.1 | 16.3 |',
    '| 09-15 | 28.6 / 22.9 | 无雨 | 14.4 |',
    '明天起转多云到晴，**9/13** 最低温。',
  ].join('\n');

  it('extractText joins _liveParts for growing body, not the 96-char preview tail', () => {
    const overlay = {
      role: 'assistant',
      content: [{ type: 'text', text: '| 日期 |' }],
      [LIVE_PARTS_KEY]: [fullReply],
      [LIVE_FIELD_KEY]: 'text',
      [LIVE_BLOCK_INDEX_KEY]: 0,
      [LIVE_TAIL_KEY]: liveTextTail([fullReply]),
    };

    const text = extractText(overlay);
    expect(text).toContain('09-03');
    expect(text).toContain('明天起转多云到晴');
    expect(text).toBe(fullReply);
    expect(text).not.toBe(overlay[LIVE_TAIL_KEY]);
  });
});
