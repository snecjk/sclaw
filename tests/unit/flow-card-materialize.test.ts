import { describe, expect, it } from 'vitest';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';
import { extractFlowCard } from '@/lib/flow-card-patch';
import type { RawMessage } from '@/stores/chat/types';

describe('extractFlowCard display-time fence parse', () => {
  it('reads native flow_card blocks', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'a1',
      content: [createFlowCardBlock({ cardId: 'c1', phase: 'editing', title: '解析完成' })],
    };
    expect(extractFlowCard(message)?.cardId).toBe('c1');
  });

  it('parses ```flow_card fences without mutating store', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'a2',
      content: [
        '开始新建报价。',
        '```flow_card',
        JSON.stringify({
          cardId: 'quote-1',
          phase: 'awaiting_upload',
          title: '开始新建报价',
          actions: [{
            id: 'upload',
            label: '上传',
            kind: 'composer.openFilePicker',
          }],
        }),
        '```',
      ].join('\n'),
    };
    const card = extractFlowCard(message);
    expect(card?.type).toBe('flow_card');
    expect(card?.cardId).toBe('quote-1');
    expect(card?.phase).toBe('awaiting_upload');
    expect(card?.actions?.[0]?.kind).toBe('composer.openFilePicker');
  });
});
