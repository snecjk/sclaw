import { describe, expect, it } from 'vitest';
import { splitTextByAtMentions } from '../../src/lib/at-mention-highlight';

describe('at mention highlight', () => {
  it('splits user message with dingtalk mentions', () => {
    expect(splitTextByAtMentions('把这首诗发给@谷研硕')).toEqual([
      { type: 'text', value: '把这首诗发给' },
      { type: 'mention', value: '@谷研硕' },
    ]);
  });

  it('splits multiple mentions', () => {
    expect(splitTextByAtMentions('@谷研硕 @李峥 你好')).toEqual([
      { type: 'mention', value: '@谷研硕' },
      { type: 'text', value: ' ' },
      { type: 'mention', value: '@李峥' },
      { type: 'text', value: ' 你好' },
    ]);
  });

  it('leaves plain text unchanged', () => {
    expect(splitTextByAtMentions('帮我写周报')).toEqual([
      { type: 'text', value: '帮我写周报' },
    ]);
  });
});
