import { describe, expect, it } from 'vitest';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';
import {
  buildFlowCardPreviewSyncSnapshot,
  computeFlowCardPreviewNotifies,
  readFlowCardPreviewSyncSnapshot,
  seedQuoteFlowCardSessionState,
  shouldNavigateQuoteFlowCardPreview,
  syncQuoteFlowCardSession,
  writeFlowCardPreviewSyncSnapshot,
} from '@/lib/quote-flow-card-session-sync';
import type { RawMessage } from '@/stores/chat/types';

describe('quote-flow-card-session-sync', () => {
  it('does not open preview when snapshot unchanged', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'validating',
      data: { ossKey: 'vip/osstmp/a' },
    });
    const current = buildFlowCardPreviewSyncSnapshot(card);
    writeFlowCardPreviewSyncSnapshot('sess-1', 'quote-active', current);

    const notifies = computeFlowCardPreviewNotifies({
      card,
      prev: readFlowCardPreviewSyncSnapshot('sess-1', 'quote-active'),
      current,
    });
    expect(notifies).toEqual([]);
  });

  it('opens preview when ossKey first appears (upload done)', () => {
    const prevCard = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'validating',
      data: {},
    });
    const nextCard = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'validating',
      data: { ossKey: 'vip/osstmp/a' },
    });
    const prev = buildFlowCardPreviewSyncSnapshot(prevCard);
    const current = buildFlowCardPreviewSyncSnapshot(nextCard);

    expect(computeFlowCardPreviewNotifies({
      card: nextCard,
      prev,
      current,
    })).toEqual(['preview']);
    expect(shouldNavigateQuoteFlowCardPreview('sess-2', nextCard)).toBe(true);
  });

  it('does not navigate for ossKey already in loaded history', () => {
    const messages: RawMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: [
          createFlowCardBlock({
            cardId: 'quote-active',
            phase: 'validating',
            data: { ossKey: 'vip/osstmp/a' },
          }),
        ],
      },
    ];
    seedQuoteFlowCardSessionState('sess-3', messages);
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'validating',
      data: { ossKey: 'vip/osstmp/a' },
    });
    expect(shouldNavigateQuoteFlowCardPreview('sess-3', card)).toBe(false);
    syncQuoteFlowCardSession('sess-3', messages);
    expect(shouldNavigateQuoteFlowCardPreview('sess-3', card)).toBe(false);
  });

  it('opens again when ossKey changes (re-upload)', () => {
    const prevCard = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'validating',
      data: { ossKey: 'vip/osstmp/a' },
    });
    const nextCard = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'validating',
      data: { ossKey: 'vip/osstmp/b' },
    });
    writeFlowCardPreviewSyncSnapshot('sess-4', 'quote-active', buildFlowCardPreviewSyncSnapshot(prevCard));
    const opened = new Set(['vip/osstmp/a']);
    // simulate prior open
    seedQuoteFlowCardSessionState('sess-4', [
      { id: 'm1', role: 'assistant', content: [prevCard] },
    ]);

    const notifies = computeFlowCardPreviewNotifies({
      card: nextCard,
      prev: buildFlowCardPreviewSyncSnapshot(prevCard),
      current: buildFlowCardPreviewSyncSnapshot(nextCard),
    });
    expect(notifies).toEqual(['preview']);
    expect(shouldNavigateQuoteFlowCardPreview('sess-4', nextCard)).toBe(true);
    expect(opened.has('vip/osstmp/b')).toBe(false);
  });

  it('does not open preview for batch_adjust card with previewUrl only', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      phase: 'batch_adjust',
      data: {
        scene: 'batch_adjust',
        previewUrl: 'https://wd-vip.sto.cn/vipLogin#/quote-ops-console',
        batchAdjustParams: {
          objectList: [{
            objectName: '刘飞',
            sceneType: 'CUSTOMER',
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            items: [],
          }],
        },
      },
    });
    const current = buildFlowCardPreviewSyncSnapshot(card);

    expect(computeFlowCardPreviewNotifies({ card, prev: null, current })).toEqual([]);
    expect(shouldNavigateQuoteFlowCardPreview('sess-batch', card)).toBe(false);
  });
});
