import { describe, expect, it } from 'vitest';
import {
  listMissingBatchAdjustFields,
  normalizeBatchAdjustSceneType,
  parseBatchAdjustDraft,
  parseBatchAdjustParams,
  parseCliJsonArray,
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

  it('parses CLI objectListJson string', () => {
    const objectList = [{
      objectName: '王豪生',
      sceneType: 'CUSTOMER',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      items: [{
        areaDetail: 'ALL',
        startWeight: '0',
        startWeightMark: '<',
        endWeight: '1',
        endWeightMark: '<=',
        adjustType: 'ADD',
        adjustValue: '0.5',
      }],
    }];
    const params = parseBatchAdjustParams({
      freightFeeType: 'BASE_FREIGHT_FEE',
      objectListJson: JSON.stringify(objectList),
    });
    expect(params?.objectList[0]?.objectName).toBe('王豪生');
    expect(params?.objectList[0]?.items[0]?.adjustValue).toBe('0.5');
  });

  it('parses double-encoded objectListJson', () => {
    const objectList = [{
      objectName: 'ALL',
      sceneType: 'CUSTOMER',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      items: [{
        areaDetail: 'ALL',
        startWeight: '0',
        startWeightMark: '<',
        endWeight: '1',
        endWeightMark: '<=',
        adjustType: 'ADD',
        adjustValue: '0.5',
      }],
    }];
    const params = parseBatchAdjustParams({
      objectListJson: JSON.stringify(JSON.stringify(objectList)),
    });
    expect(params?.objectList[0]?.objectName).toBe('ALL');
  });

  it('parses quotationListJson for draft / save', () => {
    const quotationList = [{ quoteId: 'Q-1', objectName: '王豪生' }];
    const draft = parseBatchAdjustDraft({
      quotationListJson: JSON.stringify(quotationList),
    });
    expect(draft?.quotationList).toEqual(quotationList);
    expect(parseCliJsonArray('not-json')).toBeNull();
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

  it('maps sceneType 店铺 to SHOP, not 电子面单', () => {
    expect(normalizeBatchAdjustSceneType('店铺')).toBe('SHOP');
    expect(normalizeBatchAdjustSceneType('shop')).toBe('SHOP');
    expect(normalizeBatchAdjustSceneType('客户')).toBe('CUSTOMER');
    expect(normalizeBatchAdjustSceneType('业务员')).toBe('MANAGER');
    expect(normalizeBatchAdjustSceneType('承包区')).toBe('ZONE');
    expect(normalizeBatchAdjustSceneType('电子面单')).toBe('电子面单');
  });

  it('normalizes Chinese sceneType when parsing objectList', () => {
    const params = parseBatchAdjustParams({
      objectList: [{
        objectName: '测试店',
        sceneType: '店铺',
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        items: [{
          areaDetail: 'ALL',
          startWeight: '0',
          startWeightMark: '<',
          endWeight: '1',
          endWeightMark: '<=',
          adjustType: 'ADD',
          adjustValue: '0.1',
        }],
      }],
    });
    expect(params?.objectList[0]?.sceneType).toBe('SHOP');
  });
});
