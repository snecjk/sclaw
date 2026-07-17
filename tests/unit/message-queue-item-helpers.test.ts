import { describe, expect, it } from 'vitest';
import { useMessageQueueStore } from '@/stores/message-queue';

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
});
