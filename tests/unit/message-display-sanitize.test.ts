import { describe, expect, it } from 'vitest';
import {
  extractText,
  extractThinkingTimeline,
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
