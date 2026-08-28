import { describe, expect, it } from 'vitest';
import {
  createFlowCardBlock,
  isFlowCardContentBlock,
} from '../../shared/flow-card-protocol';
import {
  findMessageIndexByFlowCardId,
  patchFlowCardInMessages,
} from '@/lib/flow-card-patch';
import type { RawMessage } from '@/stores/chat/types';

describe('flow-card-patch', () => {
  it('patches an existing flow_card block in place', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'a1',
        content: [
          createFlowCardBlock({
            cardId: 'card-1',
            phase: 'awaiting_upload',
            title: '开始',
          }),
        ],
      },
    ];

    const patched = patchFlowCardInMessages(messages, 'card-1', {
      phase: 'validating',
      title: '校验中',
    });

    expect(patched).toBe(true);
    const block = (messages[0].content as unknown[])[0];
    expect(isFlowCardContentBlock(block)).toBe(true);
    if (isFlowCardContentBlock(block)) {
      expect(block.phase).toBe('validating');
      expect(block.title).toBe('校验中');
    }
    expect(findMessageIndexByFlowCardId(messages, 'card-1')).toBe(0);
  });
});
