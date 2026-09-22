import { describe, expect, it } from 'vitest';
import {
  displaySyncStatusLabel,
  formatFieldSummary,
  formatModelRefsUsage,
  formatUpdateFreq,
  isTableDatasource,
  mapBackendType,
  toDatasourceViewItem,
} from '@/pages/DataCenter/data-manage/datasource-view';

describe('datasource-view', () => {
  it('maps excel datasource list items for the data manage cards', () => {
    const item = toDatasourceViewItem({
      id: '1',
      code: 'ds_1',
      name: '叉车明细表',
      type: 'Excel',
      status: 'success',
      statusLabel: '正常',
      statusName: '导入成功',
      models: [],
      configuration: JSON.stringify({
        accessMode: 'file',
        updateFreq: '手动刷新',
        fields: [
          { displayName: '财务结算', oldName: 'a', checked: true },
          { displayName: '财务', oldName: 'b', checked: true },
          { displayName: '结算', oldName: 'c', checked: true },
        ],
      }),
      updateTime: '2025-01-30 15:49:00',
    });

    expect(item.accessMode).toBe('file');
    expect(item.statusLabel).toBe('正常');
    expect(item.statusTone).toBe('success');
    expect(item.statusName).toBe('导入成功');
    expect(item.updateFreq).toBe('手动刷新');
    expect(formatFieldSummary(item.fields)).toBe('财务结算、财务、结算');
    expect(formatModelRefsUsage(item.models)).toBe('未引用');
    expect(item.updatedAt).toBe('2025/01/30 15:49');
    expect(isTableDatasource(item)).toBe(false);
    expect(isTableDatasource({ accessMode: 'db', type: 'Table' })).toBe(true);
  });

  it('maps backend types and fallback labels', () => {
    expect(mapBackendType('API')).toBe('api');
    expect(mapBackendType('Excel')).toBe('file');
    expect(displaySyncStatusLabel(undefined)).toBe('正常');
    expect(formatUpdateFreq({}, {})).toBe('手动刷新');
    expect(formatUpdateFreq({}, { frequency: 'daily' })).toBe('每天');
  });
});
