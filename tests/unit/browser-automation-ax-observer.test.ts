// @vitest-environment node
/**
 * 波次 2a · B6 AX 感知层（计划 §七 browser-automation-ax-observer.test.ts）：
 * - RefTable 分配/解析/稳定键；
 * - 角色过滤（只对 17 种交互 role 发 @eN ref）+ bbox 批量补齐与失败跳过；
 * - 预算三轮降级：轮 1 子树折叠（collapsed:true 保留下钻 ref）→ 轮 2 尾部弹出 → 轮 3 字段减半；
 * - collapsed 子树凭 ref 下钻（expandRef）；
 * - 负例：域不支持/无数据 → CDP_DOMAIN_UNSUPPORTED；已带码错误（CDP_TIMEOUT）原样上抛；
 * - observer 接线负例：AX 异常 → 回退 DOM 观察（observationMode 如实标注）。
 *
 * ⚠️ 全部为 mock CDP；Electron 40 embed webview 的 AX 域实机行为待 PoC（§六 R1 / §十.2）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';
import {
  AX_INTERACTIVE_ROLES,
  RefTable,
  captureAxTree,
  searchAxSnapshot,
  resolveAxClickPoint,
} from '../../electron/services/browser-automation/ax-observer';
import { observePage } from '../../electron/services/browser-automation/observer';

// ── mock 设施 ────────────────────────────────────────────────────────────────

interface RawAxNodeSpec {
  nodeId: string;
  role: string;
  name?: string;
  value?: string;
  backendId?: number;
  ignored?: boolean;
  childIds?: string[];
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

function raw(spec: RawAxNodeSpec) {
  return {
    nodeId: spec.nodeId,
    ignored: spec.ignored,
    role: { value: spec.role },
    name: spec.name !== undefined ? { value: spec.name } : undefined,
    value: spec.value !== undefined ? { value: spec.value } : undefined,
    childIds: spec.childIds,
    backendDOMNodeId: spec.backendId,
    properties: spec.properties,
  };
}

function mockCdp(
  nodes: Array<ReturnType<typeof raw>>,
  opts?: { axError?: Error; quadFailBackendIds?: Set<number>; enableDomainsError?: Error },
) {
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'Accessibility.getFullAXTree') {
      if (opts?.axError) throw opts.axError;
      return { nodes };
    }
    if (method === 'DOM.getContentQuads') {
      const id = Number(params?.backendNodeId);
      if (opts?.quadFailBackendIds?.has(id)) throw new Error('Node does not have a layout object');
      return { quads: [[id, 10, id + 50, 10, id + 50, 30, id, 30]] };
    }
    return {};
  });
  const enableDomains = vi.fn(async () => {
    if (opts?.enableDomainsError) throw opts.enableDomainsError;
  });
  return {
    enableDomains,
    send,
    isDestroyed: false,
    rawWebContents: {
      getURL: () => 'https://ax.test/',
      getTitle: () => 'AX Test',
    },
  } as unknown as BrowserAutomationCdpSession;
}

/** 基础树：root → [button(100) > StaticText, link(101)] */
function basicTree() {
  return [
    raw({ nodeId: '1', role: 'WebArea', name: '首页', backendId: 1, childIds: ['2', '5'] }),
    raw({ nodeId: '2', role: 'button', name: '提交', backendId: 100, childIds: ['3'] }),
    raw({ nodeId: '3', role: 'StaticText', name: '提交', backendId: 100 }),
    raw({ nodeId: '5', role: 'link', name: '帮助', backendId: 101, childIds: ['6'] }),
    raw({ nodeId: '6', role: 'StaticText', name: '帮助' }),
  ];
}

// ── RefTable ────────────────────────────────────────────────────────────────

describe('B6 RefTable（ref ↔ backendNodeId 主进程映射）', () => {
  it('assign/resolve/resolveStableKey/size；同 backendNodeId 复用同一 ref', () => {
    const table = new RefTable(7);
    expect(table.generation).toBe(7);
    expect(table.assign(100, { role: 'button', name: 'A' })).toBe('@e1');
    expect(table.assign(100, { role: 'button', name: 'A' })).toBe('@e1');
    expect(table.assign(101, { role: 'link', name: 'B' })).toBe('@e2');
    expect(table.resolve('@e1')).toBe(100);
    expect(table.resolve('@e2')).toBe(101);
    expect(table.resolve('@e99')).toBeUndefined();
    expect(table.resolveStableKey('@e1')).toBe('ax-100');
    expect(table.size()).toBe(2);
  });

  it('交互 role 白名单恰为 17 种', () => {
    expect(AX_INTERACTIVE_ROLES.size).toBe(17);
    expect(AX_INTERACTIVE_ROLES.has('button')).toBe(true);
    expect(AX_INTERACTIVE_ROLES.has('StaticText')).toBe(false);
  });
});

// ── captureAxTree：角色过滤 / ref 颁发 / bbox ────────────────────────────────

describe('B6 captureAxTree 基础抓取', () => {
  it('只对交互 role 发 ref；StaticText 留在快照但不进观察面；bbox 由 getContentQuads 补齐', async () => {
    const result = await captureAxTree(mockCdp(basicTree()), 1);
    expect(result.rawNodeCount).toBe(5);
    expect(result.degradationRound).toBe(0);
    expect(result.truncated).toBe(false);

    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toMatchObject({
      ref: '@e1',
      role: 'button',
      name: '提交',
      clickable: true,
      backendNodeId: 100,
      stableKey: 'ax-100',
    });
    expect(result.elements[0].boundingBox).toEqual({ x: 100, y: 10, width: 50, height: 20 });
    expect(result.elements[1]).toMatchObject({ ref: '@e2', role: 'link', clickable: true });

    // 静态节点保留在主进程快照（find 检索面），不带 ref
    const staticNode = result.snapshot.nodes.find((node) => node.role === 'StaticText');
    expect(staticNode).toBeDefined();
    expect(staticNode?.ref).toBeUndefined();

    // refTable 可双向解析
    expect(result.refTable.resolve('@e1')).toBe(100);
    expect(result.refTable.size()).toBe(2);
  });

  it('AX editable=richtext 的 generic 节点获得 @e ref 并透出 editableKind', async () => {
    const tree = [
      raw({ nodeId: '1', role: 'WebArea', name: '秒悟', backendId: 1, childIds: ['276'] }),
      raw({
        nodeId: '276',
        role: 'generic',
        name: '',
        backendId: 276,
        properties: [{ name: 'editable', value: { value: 'richtext' } }, { name: 'focusable', value: { value: true } }],
      }),
    ];
    const result = await captureAxTree(mockCdp(tree), 1, { interactiveOnly: true });
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      ref: '@e1',
      role: 'generic',
      editable: true,
      editableKind: 'richtext',
      backendNodeId: 276,
    });
    expect(result.snapshot.nodes.find((node) => node.nodeId === '276')?.states).toContain('editable');
  });

  it('getContentQuads 失败的节点跳过 bbox（字段 optional 化），不影响其余节点', async () => {
    const result = await captureAxTree(mockCdp(basicTree(), { quadFailBackendIds: new Set([101]) }), 1);
    const button = result.elements.find((el) => el.role === 'button');
    const link = result.elements.find((el) => el.role === 'link');
    expect(button?.boundingBox).toBeDefined();
    expect(link?.boundingBox).toBeUndefined();
  });
});

// ── 预算三轮降级 ────────────────────────────────────────────────────────────

describe('B6 预算降级（字符预算三轮）', () => {
  it('轮 1：无交互子树折叠为 collapsed 节点并保留下钻 ref，交互节点不受影响', async () => {
    const tree = [
      raw({ nodeId: '1', role: 'WebArea', name: 'R', backendId: 1, childIds: ['c', 'b'] }),
      raw({ nodeId: 'c', role: 'generic', name: 'ad', backendId: 200, childIds: ['t1', 't2', 't3', 't4', 't5'] }),
      ...[1, 2, 3, 4, 5].map((i) =>
        raw({ nodeId: `t${i}`, role: 'StaticText', name: `促销文案${'x'.repeat(15)}` })),
      raw({ nodeId: 'b', role: 'button', name: 'Buy', backendId: 100 }),
    ];
    const result = await captureAxTree(mockCdp(tree), 1, { budget: 200 });

    expect(result.degradationRound).toBe(1);
    expect(result.truncated).toBe(true);
    // 容器被折叠：带 collapsed 标记与下钻 ref
    const collapsed = result.elements.find((el) => el.hasCollapsedSubtree);
    expect(collapsed).toBeDefined();
    expect(collapsed?.role).toBe('generic');
    // StaticText 子节点被裁出快照
    expect(result.snapshot.nodes.some((node) => node.name.startsWith('促销文案'))).toBe(false);
    // 交互按钮完整保留
    expect(result.elements.some((el) => el.role === 'button' && el.name === 'Buy')).toBe(true);
  });

  it('轮 2：折叠无可裁时尾部弹出（保根），文档序尾部元素先丢', async () => {
    const tree = [
      raw({ nodeId: '1', role: 'WebArea', name: '', backendId: 1, childIds: Array.from({ length: 10 }, (_, i) => `b${i}`) }),
      ...Array.from({ length: 10 }, (_, i) =>
        raw({ nodeId: `b${i}`, role: 'button', name: `btn${i}${'y'.repeat(6)}`, backendId: 100 + i })),
    ];
    const result = await captureAxTree(mockCdp(tree), 1, { budget: 300 });

    expect(result.degradationRound).toBe(2);
    expect(result.truncated).toBe(true);
    const names = result.elements.map((el) => el.name);
    expect(names).toContain('btn0yyyyyy');
    expect(names).not.toContain('btn9yyyyyy');
    // 根被保住（快照根仍在）
    expect(result.snapshot.nodes[0].role).toBe('WebArea');
  });

  it('轮 3：只剩根仍超预算时 name/value/description 长度减半至达标', async () => {
    const tree = [raw({ nodeId: '1', role: 'WebArea', name: 'n'.repeat(500), backendId: 1 })];
    const result = await captureAxTree(mockCdp(tree), 1, { budget: 100 });

    expect(result.degradationRound).toBe(3);
    expect(result.snapshot.nodes[0].name.length).toBeLessThan(500);
    expect(result.snapshot.nodes[0].name.length).toBeLessThanOrEqual(46);
  });

  it('interactiveOnly：先标记"子树含交互节点"再裁剪纯静态分支', async () => {
    const tree = [
      raw({ nodeId: '1', role: 'WebArea', name: 'R', backendId: 1, childIds: ['nav', 'main'] }),
      raw({ nodeId: 'nav', role: 'navigation', name: '导航', backendId: 200, childIds: ['s1'] }),
      raw({ nodeId: 's1', role: 'StaticText', name: '纯静态说明文字' }),
      raw({ nodeId: 'main', role: 'main', name: '主体', backendId: 201, childIds: ['btn', 's2'] }),
      raw({ nodeId: 'btn', role: 'button', name: 'Go', backendId: 100 }),
      raw({ nodeId: 's2', role: 'StaticText', name: '按钮旁的说明' }),
    ];
    const result = await captureAxTree(mockCdp(tree), 1, { interactiveOnly: true });

    const keptIds = result.snapshot.nodes.map((node) => node.nodeId);
    // 纯静态 nav 分支被裁；main 分支的祖先链保留（s2 是交互节点的兄弟，无交互子树 → 裁掉）
    expect(keptIds).not.toContain('nav');
    expect(keptIds).not.toContain('s1');
    expect(keptIds).not.toContain('s2');
    expect(keptIds).toContain('main');
    expect(keptIds).toContain('btn');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].name).toBe('Go');
  });
});

// ── collapsed 下钻 ──────────────────────────────────────────────────────────

describe('B6 collapsed 子树下钻（expandRef）', () => {
  const drillTree = () => [
    raw({ nodeId: '1', role: 'WebArea', name: 'R', backendId: 1, childIds: ['c', 'b'] }),
    raw({ nodeId: 'c', role: 'generic', name: 'ad', backendId: 200, childIds: ['t1'] }),
    raw({ nodeId: 't1', role: 'StaticText', name: '被折叠的细节文案内容' }),
    raw({ nodeId: 'b', role: 'button', name: 'Buy', backendId: 100 }),
  ];

  it('凭 collapsed 节点的 ref 二次抓取其子树，取回被折叠的内容', async () => {
    // 预算 180：折叠容器后（169 chars）达标，按钮保留（轮 1 即停）
    const first = await captureAxTree(mockCdp(drillTree()), 1, { budget: 180 });
    expect(first.degradationRound).toBe(1);
    const collapsed = first.elements.find((el) => el.hasCollapsedSubtree);
    expect(collapsed).toBeDefined();
    expect(first.elements.some((el) => el.role === 'button')).toBe(true);

    // 下钻：大预算抓子树 → 被折叠的 StaticText 重新出现
    const drill = await captureAxTree(mockCdp(drillTree()), 2, {
      ref: collapsed!.ref,
      refTable: first.refTable,
      budget: 60_000,
    });
    expect(drill.snapshot.nodes.some((node) => node.name === '被折叠的细节文案内容')).toBe(true);
    expect(drill.degradationRound).toBe(0);
    // 下钻结果使用新代际的 refTable
    expect(drill.refTable.generation).toBe(2);
  });

  it('负例：未知 ref 下钻 → ELEMENT_NOT_FOUND', async () => {
    await expect(
      captureAxTree(mockCdp(basicTree()), 2, { ref: '@e99', refTable: new RefTable(1) }),
    ).rejects.toMatchObject({ code: 'ELEMENT_NOT_FOUND' });
  });
});

// ── 运行时降级（负例）──

describe('B6 AX 域降级（§六 R1）', () => {
  it('负例：getFullAXTree 抛错 → CDP_DOMAIN_UNSUPPORTED', async () => {
    await expect(
      captureAxTree(mockCdp(basicTree(), { axError: new Error("Method 'Accessibility.getFullAXTree' is not supported") }), 1),
    ).rejects.toMatchObject({ code: 'CDP_DOMAIN_UNSUPPORTED' });
  });

  it('负例：返回空树（无数据）→ CDP_DOMAIN_UNSUPPORTED', async () => {
    await expect(captureAxTree(mockCdp([]), 1)).rejects.toMatchObject({ code: 'CDP_DOMAIN_UNSUPPORTED' });
  });

  it('已带错误码的失败（CDP_TIMEOUT）原样上抛，不伪装成域不支持', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'CDP_TIMEOUT' });
    await expect(
      captureAxTree(mockCdp(basicTree(), { enableDomainsError: timeoutError }), 1),
    ).rejects.toMatchObject({ code: 'CDP_TIMEOUT' });
  });

  it('observer 接线：AX 异常 → 回退 DOM 注入观察并如实标注 observationMode', async () => {
    const failingCdp = mockCdp(basicTree(), { axError: new Error('unsupported') });
    const executeJavaScript = vi.fn(async () => ({
      url: 'https://ax.test/',
      title: 'AX Test',
      timestamp: Date.now(),
      elements: [
        {
          ref: '@e1', stableKey: 'k1', role: 'button', name: 'DOM 按钮', tag: 'button',
          selector: '#b', clickable: true, editable: false, states: [],
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
      fingerprint: 'fp-dom',
      navEpoch: 'epoch1',
    }));
    const observed = await observePage(
      's1',
      failingCdp,
      executeJavaScript,
      { networkState: 'idle', pendingRequests: 0 },
      { mode: 'ax' },
    );
    expect(observed.observationMode).toBe('dom');
    expect(observed.elements[0]?.name).toBe('DOM 按钮');
    expect(observed.axSnapshot).toBeUndefined();
    expect(observed.navEpoch).toBe('epoch1');
  });

  it('observer 接线：AX 正常 → observationMode=ax 且携带 axSnapshot（navEpoch 缺省）', async () => {
    const observed = await observePage(
      's1',
      mockCdp(basicTree()),
      vi.fn(async () => ({})),
      { networkState: 'idle', pendingRequests: 0 },
      { mode: 'ax', refGeneration: 3 },
    );
    expect(observed.observationMode).toBe('ax');
    expect(observed.axSnapshot?.generation).toBe(3);
    expect(observed.elements.length).toBe(2);
    expect(observed.navEpoch).toBeUndefined();
  });
});

// ── searchAxSnapshot（find 的 AX 检索核心，service 层另有集成测试）──

describe('B6 searchAxSnapshot', () => {
  it('text 命中静态节点 → interactiveAncestorRef 上溯到最近可交互祖先，path ≤6 层', async () => {
    const tree = [
      raw({ nodeId: '1', role: 'WebArea', name: 'R', backendId: 1, childIds: ['2'] }),
      raw({ nodeId: '2', role: 'button', name: '支付', backendId: 100, childIds: ['3'] }),
      raw({ nodeId: '3', role: 'StaticText', name: '立即支付尾款', backendId: 100 }),
    ];
    const capture = await captureAxTree(mockCdp(tree), 1);
    const matches = searchAxSnapshot(capture.snapshot, { text: '尾款' });

    expect(matches).toHaveLength(1);
    expect(matches[0].role).toBe('StaticText');
    expect(matches[0].interactiveAncestorRef).toBe('@e1');
    // 静态节点无 ref → ref 回退为可交互祖先 ref（契约非空）
    expect(matches[0].ref).toBe('@e1');
    expect(matches[0].path?.map((p) => p.role)).toEqual(['WebArea', 'button']);
  });
});

describe('AX ref 点击坐标', () => {
  it('resolveAxClickPoint 用 RefTable → quads 中心点', async () => {
    const cdp = mockCdp(basicTree());
    const capture = await captureAxTree(cdp, 1);
    const point = await resolveAxClickPoint(cdp, capture.refTable, '@e1');
    expect(point).toEqual({ x: 125, y: 20 });
  });

  it('未知 ref 返回 null，不把页内 refMap 当成 AX 引用', async () => {
    const cdp = mockCdp(basicTree());
    const capture = await captureAxTree(cdp, 1);
    expect(await resolveAxClickPoint(cdp, capture.refTable, '@e99')).toBeNull();
  });
});
