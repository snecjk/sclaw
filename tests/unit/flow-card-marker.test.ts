import { describe, expect, it } from 'vitest';
import {
  parseFlowCardFence,
  parseFlowCardPayload,
  stripFlowCardFences,
} from '@/lib/flow-card-marker';

describe('flow-card-marker', () => {
  it('parses a flow_card fenced payload', () => {
    const text = [
      '开始处理。',
      '```flow_card',
      JSON.stringify({
        cardId: 'card-1',
        phase: 'awaiting_upload',
        title: '上传',
        actions: [{
          id: 'upload',
          label: '上传',
          kind: 'composer.openFilePicker',
        }],
      }),
      '```',
    ].join('\n');

    const parsed = parseFlowCardFence(text);
    expect(parsed?.cardId).toBe('card-1');
    expect(parsed?.phase).toBe('awaiting_upload');
    expect(parsed?.actions?.[0]?.kind).toBe('composer.openFilePicker');
  });

  it('strips flow_card fences from assistant text', () => {
    const stripped = stripFlowCardFences('说明\n```flow_card\n{"cardId":"c","phase":"x"}\n```\n');
    expect(stripped).toBe('说明');
  });

  it('parses fence without newline before closing ticks', () => {
    const text = '```flow_card\n{"cardId":"c","phase":"awaiting_upload","title":"开始"}```';
    expect(parseFlowCardFence(text)?.cardId).toBe('c');
  });
});
