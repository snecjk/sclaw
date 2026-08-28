import { describe, expect, it } from 'vitest';
import {
  bridgeComposerFillPlainText,
  normalizeBridgeComposerFillInput,
} from '../../shared/jsbridge/composer-fill-segments';

describe('normalizeBridgeComposerFillInput', () => {
  it('accepts legacy text-only params', () => {
    expect(normalizeBridgeComposerFillInput({ text: ' hello ' })).toEqual([
      { type: 'text', text: 'hello' },
    ]);
  });

  it('accepts structured segments', () => {
    expect(normalizeBridgeComposerFillInput({
      segments: [
        { type: 'skill', slug: 'quote-assistant' },
        { type: 'text', text: '新建报价' },
        { type: 'workflow', id: 'wf_1', name: '报价流程' },
      ],
    })).toEqual([
      { type: 'skill', slug: 'quote-assistant' },
      { type: 'text', text: '新建报价' },
      { type: 'workflow', id: 'wf_1', name: '报价流程' },
    ]);
  });

  it('prefers segments over text when both provided', () => {
    expect(normalizeBridgeComposerFillInput({
      text: 'ignored',
      segments: [{ type: 'text', text: 'used' }],
    })).toEqual([{ type: 'text', text: 'used' }]);
  });

  it('rejects empty input', () => {
    expect(normalizeBridgeComposerFillInput({})).toBeNull();
    expect(normalizeBridgeComposerFillInput({ segments: [] })).toBeNull();
    expect(normalizeBridgeComposerFillInput({ segments: [{ type: 'skill', slug: '  ' }] })).toBeNull();
  });
});

describe('bridgeComposerFillPlainText', () => {
  it('concatenates text and workflow names', () => {
    expect(bridgeComposerFillPlainText([
      { type: 'text', text: '帮我' },
      { type: 'skill', slug: 'quote-assistant' },
      { type: 'workflow', id: 'wf_1', name: '报价' },
      { type: 'text', text: '一下' },
    ])).toBe('帮我报价一下');
  });
});
