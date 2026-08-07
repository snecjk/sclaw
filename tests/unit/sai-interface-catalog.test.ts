import { describe, expect, it } from 'vitest';
import {
  deriveInterfaceDisplayName,
  filterSaiInterfaceCatalog,
  mergeCatalogLocalFirst,
  normalizeSaiInterfaceCatalog,
  parseSaiInterfaceCatalogPage,
  takeCatalogWindow,
} from '@/lib/sai-interface-catalog';

describe('deriveInterfaceDisplayName', () => {
  it('prefers commandName as the display title', () => {
    expect(
      deriveInterfaceDisplayName({
        path: 'network.org-employee.query',
        commandName: '根据网点编码查询员工',
        description: '根据网点编码查询该网点下的员工信息列表',
        summary: '其它摘要',
      }),
    ).toBe('根据网点编码查询员工');
  });

  it('uses commandName even when it is english-like', () => {
    expect(
      deriveInterfaceDisplayName({
        path: 'network.inport-efficiency-summary.query',
        commandName: 'network inport-efficiency-summary query',
        description: '进港服务诊断-时效考核预警汇总明细',
      }),
    ).toBe('network inport-efficiency-summary query');
  });

  it('falls back to description when commandName is missing', () => {
    expect(
      deriveInterfaceDisplayName({
        path: 'finance.basic-account-trans-detail.search',
        description: '查交易明细',
        summary: '查询基本户账户每日交易明细列表，支持按业务日期筛选',
      }),
    ).toBe('查交易明细');
  });

  it('falls back to summary when commandName and description are missing', () => {
    expect(
      deriveInterfaceDisplayName({
        path: 'baseinfo.employee-info.search',
        summary: '执行申通员工信息的模糊搜索操作，适用于找人、查人或核对人员列表场景。',
      }),
    ).toBe('执行申通员工信息的模糊搜索操作');
  });
});

describe('normalizeSaiInterfaceCatalog', () => {
  it('maps commandName to name and description to description', () => {
    const items = normalizeSaiInterfaceCatalog({
      commands: [
        {
          path: 'network.org-employee.query',
          commandName: '根据网点编码查询员工',
          summary: '查询某个网点下的员工列表',
          description: '根据网点编码查询该网点下的员工信息列表，返回员工姓名、工号等。',
          tags: ['小件员', '网点员工'],
        },
        {
          path: 'policy.volume-biznum.query',
          summary: '查询发件量',
          description: '按日维度查询发件量',
        },
      ],
    });
    expect(items[0]).toMatchObject({
      path: 'network.org-employee.query',
      name: '根据网点编码查询员工',
      description: '根据网点编码查询该网点下的员工信息列表，返回员工姓名、工号等。',
    });
    expect(items[1]?.name).toBe('按日维度查询发件量');
  });

  it('unwraps outer ok/data envelope', () => {
    const items = normalizeSaiInterfaceCatalog({
      ok: true,
      data: {
        commands: [{ path: 'a.b.c', description: '示例查询' }],
      },
    });
    expect(items).toEqual([
      { path: 'a.b.c', name: '示例查询', description: '示例查询' },
    ]);
  });

  it('parses discover candidates and keeps score order', () => {
    const items = normalizeSaiInterfaceCatalog({
      candidates: [
        {
          path: 'market.sdd-demand-province.query',
          summary: '申咚咚省区履约明细',
          score: 0.76,
        },
        {
          path: 'market.sdd-channel.list',
          summary: '申咚咚类型列表查询',
          score: 0.42,
        },
      ],
      query: '申咚咚看板渠道列表',
    });
    expect(items.map((item) => item.path)).toEqual([
      'market.sdd-demand-province.query',
      'market.sdd-channel.list',
    ]);
    expect(items[1]?.name).toBe('申咚咚类型列表查询');
    expect(items[1]?.score).toBe(0.42);
  });
});

describe('parseSaiInterfaceCatalogPage', () => {
  it('marks hasMore when more pages remain', () => {
    const page = parseSaiInterfaceCatalogPage(
      {
        commands: Array.from({ length: 20 }, (_, i) => ({
          path: `a.b.c${i}`,
          summary: `接口${i}`,
        })),
        page: 1,
        pageSize: 20,
        total: 107,
      },
      { page: 1, pageSize: 20 },
    );
    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(107);
  });
});

describe('mergeCatalogLocalFirst', () => {
  it('keeps local substring hits ahead of discover noise and dedupes by path', () => {
    const merged = mergeCatalogLocalFirst(
      [
        { path: 'market.sdd-channel.list', name: '申咚咚类型列表', description: 'list' },
        { path: 'baseinfo.organize.search', name: '查网点', description: 'list' },
      ],
      [
        { path: 'market.other.query', name: '其他', description: 'discover' },
        { path: 'market.sdd-channel.list', name: '渠道列表', description: 'discover' },
      ],
    );
    expect(merged.map((item) => item.path)).toEqual([
      'market.sdd-channel.list',
      'baseinfo.organize.search',
      'market.other.query',
    ]);
    expect(merged[0]?.description).toBe('list');
  });
});

describe('filterSaiInterfaceCatalog', () => {
  it('filters locally by chinese name or path', () => {
    const items = [
      { path: 'market.sdd-channel.list', name: '申咚咚类型列表', description: '渠道' },
      { path: 'baseinfo.organize.search', name: '查网点', description: '组织' },
    ];
    expect(filterSaiInterfaceCatalog(items, '申咚咚').map((item) => item.path)).toEqual([
      'market.sdd-channel.list',
    ]);
  });

  it('searches the full catalog, not only a visible page window', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      path: `demo.item.${index}`,
      name: index === 35 ? '目标接口在靠后页' : `接口${index}`,
      description: `desc-${index}`,
    }));
    expect(filterSaiInterfaceCatalog(items, '靠后页').map((item) => item.path)).toEqual([
      'demo.item.35',
    ]);
  });
});

describe('takeCatalogWindow', () => {
  it('slices the frontend window from the matched catalog', () => {
    const items = [
      { path: 'a', name: 'A', description: '' },
      { path: 'b', name: 'B', description: '' },
      { path: 'c', name: 'C', description: '' },
    ];
    expect(takeCatalogWindow(items, 2).map((item) => item.path)).toEqual(['a', 'b']);
    expect(takeCatalogWindow(items, 10)).toEqual(items);
    expect(takeCatalogWindow(items, 0)).toEqual([]);
  });
});
