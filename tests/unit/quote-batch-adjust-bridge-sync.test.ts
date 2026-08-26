import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';
import {
  resolveLatestBatchAdjustBridgePayload,
  seedBatchAdjustParamsBridgeState,
  syncBatchAdjustParamsBridge,
} from '@/lib/quote-batch-adjust-bridge-sync';
import type { RawMessage } from '@/stores/chat/types';

const emitMock = vi.fn();
const runtimeMock = vi.fn(() => 'embed-runtime-1');

vi.mock('@/lib/quote-bridge-emit', () => ({
  emitBatchAdjustParamsReady: (...args: unknown[]) => emitMock(...args),
}));

vi.mock('@/lib/flow-card-preview', () => ({
  resolveEmbedRuntimeIdForChatSession: (...args: unknown[]) => runtimeMock(...args),
}));

const batchParams = {
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

function batchMessages(): RawMessage[] {
  return [{
    id: 'm1',
    role: 'assistant',
    content: [
      createFlowCardBlock({
        cardId: 'quote-active',
        phase: 'batch_adjust',
        data: {
          scene: 'batch_adjust',
          previewUrl: 'https://wd-vip.sto.cn/vipLogin#/quote-ops-console',
          batchAdjustParams: batchParams,
        },
      }),
    ],
  }];
}

describe('quote-batch-adjust-bridge-sync', () => {
  beforeEach(() => {
    emitMock.mockClear();
    runtimeMock.mockClear();
    runtimeMock.mockReturnValue('embed-runtime-1');
  });

  it('resolves latest batchAdjustParams from messages', () => {
    const payload = resolveLatestBatchAdjustBridgePayload(batchMessages());
    expect(payload?.params.objectList[0]?.objectName).toBe('刘飞');
    expect(payload?.previewUrl).toContain('quote-ops-console');
  });

  it('emits batch-adjust.params-ready from params signature (not card diff)', () => {
    syncBatchAdjustParamsBridge('sess-batch-live', batchMessages());

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0]?.[0]).toMatchObject({
      runtimeId: 'embed-runtime-1',
      params: batchParams,
      cardId: 'quote-active',
      phase: 'batch_adjust',
    });
  });

  it('does not re-emit the same params after seeding history', () => {
    const messages = batchMessages();
    seedBatchAdjustParamsBridgeState('sess-batch-history', messages);
    syncBatchAdjustParamsBridge('sess-batch-history', messages);
    expect(emitMock).not.toHaveBeenCalled();
  });
});
