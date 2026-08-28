import { describe, expect, it } from 'vitest';
import { useMessageQueueStore } from '@/stores/message-queue';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

const zhangsan: DingTalkMention = { type: 'user', displayName: '张三', userId: 'u-1' };

function enqueueMentionItem(text: string) {
  const store = useMessageQueueStore.getState();
  store.clearAll();
  const segments: PersistedComposerSegment[] = [
    { type: 'text', text: '请 ' },
    { type: 'mention', mention: zhangsan },
    { type: 'text', text: ' 看一下' },
  ];
  store.enqueue(
    'agent:main:session-1',
    text,
    undefined,
    undefined,
    [zhangsan],
    undefined,
    undefined,
    { composerSegments: segments },
  );
  return store.getQueue('agent:main:session-1')[0]!;
}

describe('message queue item helpers', () => {
  it('updates queued text in place', () => {
    const store = useMessageQueueStore.getState();
    store.clearAll();
    store.enqueue('agent:main:session-1', 'first draft');
    const [item] = store.getQueue('agent:main:session-1');
    store.updateText('agent:main:session-1', item.id, 'final draft');
    expect(store.getQueue('agent:main:session-1')[0]?.text).toBe('final draft');
  });

  it('takes a specific queued item by id', () => {
    const store = useMessageQueueStore.getState();
    store.clearAll();
    store.enqueue('agent:main:session-1', 'one');
    store.enqueue('agent:main:session-1', 'two');
    const queue = store.getQueue('agent:main:session-1');
    const removed = store.takeById('agent:main:session-1', queue[1].id);
    expect(removed?.text).toBe('two');
    expect(store.getQueue('agent:main:session-1').map((item) => item.text)).toEqual(['one']);
  });

  it('re-anchors kept mentions as segments so text no longer double-renders them', () => {
    const item = enqueueMentionItem('请 @张三 看一下');
    const store = useMessageQueueStore.getState();
    store.updateText('agent:main:session-1', item.id, '麻烦 @张三 明天看一下');

    const [next] = store.getQueue('agent:main:session-1');
    expect(next?.dingTalkMentions).toEqual([zhangsan]);
    const segments = next?.composerSegments ?? [];
    const mentionCount = segments.filter((seg) => seg.type === 'mention').length;
    expect(mentionCount).toBe(1);
    // 文本段不再含 @张三，气泡不会正则再渲染一次
    const textBody = segments
      .filter((seg) => seg.type === 'text')
      .map((seg) => (seg as { text: string }).text)
      .join('');
    expect(textBody).not.toContain('@张三');
    expect(textBody).toContain('麻烦');
    expect(textBody).toContain('明天看一下');
  });

  it('drops mentions removed from the edited text so no DING is sent', () => {
    const item = enqueueMentionItem('请 @张三 看一下');
    const store = useMessageQueueStore.getState();
    store.updateText('agent:main:session-1', item.id, '请李四看一下');

    const [next] = store.getQueue('agent:main:session-1');
    expect(next?.dingTalkMentions).toEqual([]);
    expect(next?.composerSegments?.every((seg) => seg.type !== 'mention')).toBe(true);
  });

  it('keeps skill chips in place while rebuilding text around them', () => {
    const store = useMessageQueueStore.getState();
    store.clearAll();
    const segments: PersistedComposerSegment[] = [
      { type: 'skill', slug: 'report', title: '日报' },
      { type: 'text', text: '帮我写本周日报' },
    ];
    store.enqueue(
      'agent:main:session-1',
      '帮我写本周日报',
      undefined,
      undefined,
      undefined,
      undefined,
      { slug: 'report', title: '日报' },
      { composerSegments: segments },
    );
    const [item] = store.getQueue('agent:main:session-1');
    store.updateText('agent:main:session-1', item.id, '帮我写上周日报');

    const [next] = store.getQueue('agent:main:session-1');
    expect(next?.composerSegments?.[0]).toEqual({ type: 'skill', slug: 'report', title: '日报' });
    expect(next?.composerSegments?.[1]).toEqual({ type: 'text', text: '帮我写上周日报' });
  });
});
