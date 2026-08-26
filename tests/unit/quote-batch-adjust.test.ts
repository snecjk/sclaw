import { describe, expect, it } from 'vitest';
import {
  listMissingBatchAdjustFields,
  parseBatchAdjustParams,
  serializeBatchAdjustObjectListJson,
} from '../../shared/quote-batch-adjust';

describe('quote-batch-adjust', () => {
  it('parses batchAdjustParams from flow_card data', () => {
    const params = parseBatchAdjustParams({
      batchAdjustParams: {
        freightFeeType: 'BASE_FREIGHT_FEE',
        summary: '李佳明 3kg+ 加0.2',
        objectList: [{
          objectName: '李佳明',
          sceneType: 'CUSTOMER',
          startDate: '2026-08-01',
          endDate: '2026-12-31',
          items: [{
            areaDetail: 'ALL',
            startWeight: '3',
            startWeightMark: '<',
            endWeight: '999',
            endWeightMark: '<=',
            adjustType: 'ADD',
            adjustValue: '0.2',
          }],
        }],
      },
    });
    expect(params?.objectList).toHaveLength(1);
    expect(params?.objectList[0]?.items[0]?.adjustValue).toBe('0.2');
  });

  it('serializes objectListJson for CLI', () => {
    const json = serializeBatchAdjustObjectListJson([{
      objectName: 'ALL',
      sceneType: 'CUSTOMER',
      startDate: '2026-11-01',
      endDate: '2027-02-28',
      items: [{
        areaDetail: '黑龙江省',
        startWeight: '0',
        startWeightMark: '<',
        endWeight: '999',
        endWeightMark: '<=',
        adjustType: 'ADD',
        adjustValue: '0.2',
      }],
    }]);
    expect(JSON.parse(json)[0].objectName).toBe('ALL');
  });

  it('lists missing fields for incomplete NL parse', () => {
    const missing = listMissingBatchAdjustFields({
      objectList: [{
        objectName: '李佳明',
        sceneType: 'CUSTOMER',
        startDate: '',
        endDate: '',
        items: [{
          areaDetail: 'ALL',
          startWeight: '3',
          startWeightMark: '<',
          endWeight: '999',
          endWeightMark: '<=',
          adjustType: 'ADD',
          adjustValue: '0.2',
        }],
      }],
    });
    expect(missing.some((field) => field.path.includes('startDate'))).toBe(true);
    expect(missing.some((field) => field.path.includes('endDate'))).toBe(true);
  });
});
