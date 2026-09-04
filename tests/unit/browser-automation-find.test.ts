// @vitest-environment node
/**
 * 波次 2a · B4 find（计划 §七 browser-automation-find.test.ts）：
 * - AX 模式：文本命中静态节点 → interactiveAncestorRef 上溯可交互祖先；
 * - interactiveOnly 过滤；maxResults 截断（totalMatches + hint）；
 * - 无树时先 observe（复用串行队列与代际机制）；
 * - AX 不可用时回退 DOM 观察面检索。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

type FakeWebContents = import('electron').WebContents;

const state = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
  runtimeMeta: new Map<string, { visible?: boolean }>(),
}));

const repoMock = vi.hoisted(() => ({
  upsertSession: vi.fn(async () => undefined),
  createRun: vi.fn(async () => 'run-1'),
  upsertStepRun: vi.fn(async () => undefined),
  listStepRuns: vi.fn(async () => [] as Array<Record<string, unknown>>),
  completeRun: vi.fn(async () => undefined),
}));

vi.mock('../../electron/db/repositories/browser-automation-repository', () => ({
  browserAutomationRepository: repoMock,
}));

vi.mock('../../electron/services/browser-automation/session-manager', () => ({
  buildEmbedSessionId: (runtimeId: string) => `embed-${runtimeId}`,
  parseEmbedRuntimeId: (sessionId: string) =>
    sessionId.startsWith('embed-') ? sessionId.slice('embed-'.length) || null : null,
  isSessionExpired: () => false,
  logSessionEvent: vi.fn(),
  resolveEmbedWebContents: (runtimeId: string) => state.webContentsByRuntime.get(runtimeId) ?? null,
  resolveSessionWebContents: (session: { source: string; embedRuntimeId?: string }) =>
    session.source === 'embed' && session.embedRuntimeId
      ? state.webContentsByRuntime.get(session.embedRuntimeId) ?? null
      : null,
  createManagedSession: vi.fn(async () => {
    throw new Error('not used in this test file');
  }),
  closeManagedSession: vi.fn(),
  closeOwnedSession: vi.fn(),
  navigateWebContents: vi.fn(async () => undefined),
  getManagedWindowVisibility: vi.fn(() => null),
}));

vi.mock('../../electron/main/services/sclaw-embed-browser-runtime', () => ({
  getSclawEmbedBrowserNetworkLog: () => [],
  getSclawEmbedBrowserRuntime: (runtimeId: string) => state.runtimeMeta.get(runtimeId) ?? null,
}));

interface RawAxNodeSpec {
  nodeId: string;
  role: string;
  name?: string;
  backendId?: number;
  childIds?: string[];
}

function raw(spec: RawAxNodeSpec) {
  return {
    nodeId: spec.nodeId,
    role: { value: spec.role },
    name: spec.name !== undefined ? { value: spec.name } : undefined,
    childIds: spec.childIds,
    backendDOMNodeId: spec.backendId,
  };
}

/** 电商页：root → [button 提交订单 > StaticText 立即支付尾款, link 帮助] */
function shopTree() {
  return [
    raw({ nodeId: '1', role: 'WebArea', name: '商城', backendId: 1, childIds: ['2', '5'] }),
    raw({ nodeId: '2', role: 'button', name: '提交订单', backendId: 100, childIds: ['3'] }),
    raw({ nodeId: '3', role: 'StaticText', name: '立即支付尾款' }),
    raw({ nodeId: '5', role: 'link', name: '帮助中心', backendId: 101 }),
  ];
}

function cannedDomObservation() {
  return {
    url: 'https://shop.test/',
    title: '商城',
    timestamp: Date.now(),
    elements: [
      {
        ref: '@e1', stableKey: 'k1', role: 'button', name: '提交订单', tag: 'button',
        selector: '#submit', clickable: true, editable: false, states: [],
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        ref: '@e2', stableKey: 'k2', role: 'textbox', name: '搜索商品', tag: 'input',
        selector: '#q', clickable: false, editable: true, states: [],
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    fingerprint: 'fp',
    navEpoch: 'epochA',
  };
}

function createFakeWebContents(id: number, axNodes: Array<ReturnType<typeof raw>> | null) {
  const emitter = new EventEmitter();
  const dbgState = { attached: false };
  const fakeDebugger = Object.assign(emitter, {
    isAttached: vi.fn(() => dbgState.attached),
    attach: vi.fn(async () => {
      dbgState.attached = true;
    }),
    detach: vi.fn(() => {
      dbgState.attached = false;
    }),
    sendCommand: vi.fn(async (method: string) => {
      if (method === 'Accessibility.getFullAXTree') {
        if (!axNodes) throw new Error('Accessibility domain not supported');
        return { nodes: axNodes };
      }
      if (method === 'DOM.getContentQuads') return { quads: [] };
      return {};
    }),
  });
  const executeJavaScript = vi.fn(async () => cannedDomObservation());
  const wc = {
    id,
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => 'https://shop.test/'),
    getTitle: vi.fn(() => '商城'),
    executeJavaScript,
    debugger: fakeDebugger,
    getZoomFactor: vi.fn(() => 1),
  } as unknown as FakeWebContents;
  return { wc, executeJavaScript, fakeDebugger };
}

function setupSession(runtimeId: string, bundle: ReturnType<typeof createFakeWebContents>) {
  state.webContentsByRuntime.set(runtimeId, bundle.wc);
  state.runtimeMeta.set(runtimeId, { visible: true });
}

beforeEach(() => {
  state.webContentsByRuntime.clear();
  state.runtimeMeta.clear();
  vi.clearAllMocks();
});

describe('B4 find（AX 树内检索）', () => {
  it('text 命中静态节点 → interactiveAncestorRef 上溯可交互祖先，path ≤6 层', async () => {
    const service = new BrowserAutomationService();
    setupSession('r1', createFakeWebContents(1, shopTree()));
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1', { mode: 'ax' });

    const result = await service.find('embed-r1', { text: '支付尾款' });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(match.role).toBe('StaticText');
    expect(match.interactiveAncestorRef).toBe('@e1');
    expect(match.ref).toBe('@e1'); // 静态节点 ref 回退为祖先 ref
    expect(match.path?.map((p) => p.role)).toEqual(['WebArea', 'button']);
    expect(result.documentGeneration).toBe(1);
  });

  it('role 检索 + interactiveOnly 过滤', async () => {
    const service = new BrowserAutomationService();
    setupSession('r1', createFakeWebContents(1, shopTree()));
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1', { mode: 'ax' });

    const buttons = await service.find('embed-r1', { role: 'button' });
    expect(buttons.matches.map((m) => m.name)).toEqual(['提交订单']);

    // interactiveOnly=false 时 role 可命中非交互节点
    const statics = await service.find('embed-r1', { role: 'StaticText', interactiveOnly: false });
    expect(statics.matches.map((m) => m.name)).toEqual(['立即支付尾款']);
    // 默认 interactiveOnly=true 时 role 检索不命中静态节点
    const filtered = await service.find('embed-r1', { role: 'StaticText' });
    expect(filtered.matches).toHaveLength(0);
  });

  it('maxResults 截断：返回 totalMatches + 缩小提示', async () => {
    const manyButtons = [
      raw({ nodeId: '1', role: 'WebArea', name: '', backendId: 1, childIds: Array.from({ length: 30 }, (_, i) => `b${i}`) }),
      ...Array.from({ length: 30 }, (_, i) =>
        raw({ nodeId: `b${i}`, role: 'button', name: `按钮${i}`, backendId: 100 + i })),
    ];
    const service = new BrowserAutomationService();
    setupSession('r1', createFakeWebContents(1, manyButtons));
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1', { mode: 'ax' });

    const result = await service.find('embed-r1', { role: 'button' });
    expect(result.matches).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBe(30);
    expect(result.hint).toContain('30');

    const narrowed = await service.find('embed-r1', { role: 'button', name: '按钮7', maxResults: 5 });
    expect(narrowed.matches).toHaveLength(1);
    expect(narrowed.truncated).toBe(false);
  });

  it('无可用快照时 find 先自动 observe（代际随观察递增）', async () => {
    const service = new BrowserAutomationService();
    setupSession('r1', createFakeWebContents(1, shopTree()));
    await service.createSession({ embedRuntimeId: 'r1' });

    const result = await service.find('embed-r1', { role: 'link' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe('帮助中心');
    expect(result.documentGeneration).toBe(1);
  });
});

describe('B4 find（AX 不可用 → DOM 回退检索）', () => {
  it('AX 域不支持时回退 DOM 观察面，按 name/text 过滤', async () => {
    const service = new BrowserAutomationService();
    setupSession('r1', createFakeWebContents(1, null));
    await service.createSession({ embedRuntimeId: 'r1' });

    const observed = await service.observe('embed-r1');
    expect(observed.observationMode).toBe('dom'); // AX 失败自动回退

    const result = await service.find('embed-r1', { name: '搜索' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ ref: '@e2', role: 'textbox' });
    expect(result.documentGeneration).toBeGreaterThan(0);
  });
});
