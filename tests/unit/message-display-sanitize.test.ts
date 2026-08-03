import { describe, expect, it } from 'vitest';
import {
  extractText,
  extractThinkingTimeline,
  isWorkflowCompletionTranscript,
  stripDwsSendMetadataForDisplay,
} from '../../src/pages/Chat/message-utils';

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
