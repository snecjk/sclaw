import { describe, expect, it } from 'vitest';
import { resolveUserBubbleActionText, splitUserBubbleAtTag } from '@/pages/Chat/message-utils';

describe('splitUserBubbleAtTag', () => {
  it('无位置信息时标签渲染在正文最前（history 回写的旧消息）', () => {
    expect(splitUserBubbleAtTag('查看一下这个技能', undefined)).toEqual({
      before: '',
      after: '查看一下这个技能',
      padBefore: false,
      padAfter: true,
    });
  });

  it('标签在句末时只在左侧补分隔空格', () => {
    const text = '查看一下这个技能';
    expect(splitUserBubbleAtTag(text, text.length)).toEqual({
      before: '查看一下这个技能',
      after: '',
      padBefore: true,
      padAfter: false,
    });
  });

  it('标签在句中时沿用正文里已有的分隔空格', () => {
    expect(splitUserBubbleAtTag('查看一下 这个技能', 4)).toEqual({
      before: '查看一下',
      after: ' 这个技能',
      padBefore: true,
      padAfter: false,
    });
  });

  it('越界的位置会被夹回正文范围', () => {
    expect(splitUserBubbleAtTag('abc', 99).before).toBe('abc');
    expect(splitUserBubbleAtTag('abc', -5).before).toBe('');
  });
});

describe('resolveUserBubbleActionText 跟随标签位置', () => {
  it('标签在句末时复制文本也把技能名放在句末', () => {
    expect(
      resolveUserBubbleActionText('帮我算一下', { title: '网点面单报价', tagOffset: 5 }),
    ).toBe('帮我算一下 网点面单报价');
  });

  it('标签在句中时复制文本按视觉顺序拼接', () => {
    expect(
      resolveUserBubbleActionText('帮我算 一下', { title: '网点面单报价', tagOffset: 3 }),
    ).toBe('帮我算 网点面单报价 一下');
  });

  it('无位置信息时维持技能名在前的旧行为', () => {
    expect(
      resolveUserBubbleActionText('帮我算一下', { title: '网点面单报价' }),
    ).toBe('网点面单报价 帮我算一下');
  });
});
