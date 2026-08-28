import { describe, expect, it } from 'vitest';
import { shouldApplyJsBridgeStructuredComposerSeed } from '../../src/lib/jsbridge/apply-composer-seed';
import type { ComposerSeedEntry } from '../../src/stores/jsbridge-host';

function seed(partial: Partial<ComposerSeedEntry>): ComposerSeedEntry {
  return {
    text: '',
    token: 'seed-1',
    send: false,
    ...partial,
  };
}

describe('shouldApplyJsBridgeStructuredComposerSeed', () => {
  it('applies skill/workflow prefill when not sending', () => {
    expect(shouldApplyJsBridgeStructuredComposerSeed(seed({
      segments: [
        { type: 'skill', slug: 'quote-assistant', title: '报价' },
        { type: 'text', text: '帮我新建' },
      ],
    }))).toBe(true);
  });

  it('skips when the action already sent', () => {
    expect(shouldApplyJsBridgeStructuredComposerSeed(seed({
      send: true,
      segments: [{ type: 'skill', slug: 'quote-assistant', title: '报价' }],
    }))).toBe(false);
  });

  it('skips text-only seeds', () => {
    expect(shouldApplyJsBridgeStructuredComposerSeed(seed({
      text: 'hello',
      segments: [{ type: 'text', text: 'hello' }],
    }))).toBe(false);
  });
});
