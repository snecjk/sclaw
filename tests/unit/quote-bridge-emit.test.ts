import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitGuestMock = vi.fn();

vi.mock('@/lib/jsbridge/emit-guest-event', () => ({
  BRIDGE_EVENT_QUOTE: 'quote:event',
  emitBridgeGuestEvent: (...args: unknown[]) => emitGuestMock(...args),
}));

import { emitBatchAdjustParamsReady } from '@/lib/quote-bridge-emit';

const params = {
  freightFeeType: 'BASE_FREIGHT_FEE',
  objectList: [{
    objectName: '刘飞',
    sceneType: 'CUSTOMER',
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    items: [{
      areaDetail: 'ALL',
      startWeight: '0',
      startWeightMark: '<' as const,
      endWeight: '0.5',
      endWeightMark: '<=' as const,
      adjustType: 'ADD' as const,
      adjustValue: '0.1',
    }],
  }],
};

describe('quote-bridge-emit batch-adjust', () => {
  beforeEach(() => {
    emitGuestMock.mockClear();
  });

  it('skips identical payload from the same source message', () => {
    const input = {
      runtimeId: 'emit-runtime-same',
      params,
      cardId: 'quote-active',
      sourceMessageId: 'm1',
    };
    emitBatchAdjustParamsReady(input);
    emitBatchAdjustParamsReady(input);
    expect(emitGuestMock).toHaveBeenCalledTimes(1);
  });

  it('emits again when identical params come from a new source message', () => {
    const base = {
      runtimeId: 'emit-runtime-resend',
      params,
      cardId: 'quote-active',
    };
    emitBatchAdjustParamsReady({ ...base, sourceMessageId: 'm1' });
    emitBatchAdjustParamsReady({ ...base, sourceMessageId: 'm2' });
    expect(emitGuestMock).toHaveBeenCalledTimes(2);
  });
});
