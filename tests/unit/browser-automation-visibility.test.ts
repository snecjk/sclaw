// @vitest-environment node
/**
 * 波次 1 · B7/D1 可见性守卫（计划 §七 browser-automation-visibility.test.ts）：
 * - 负例：embed 会话 meta.visible=false → 真实输入类动作 fail-fast PAGE_NOT_VISIBLE（不触碰页面、不计 step）；
 * - managed 窗口不可见/最小化 → 拒；
 * - headless 标记（showManaged:false 离屏窗口）豁免守卫；
 * - navigate 等非真实输入类动作不受守卫约束；
 * - meta.visible 未上报（undefined）按可见处理（灰度兼容旧渲染层）。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

type FakeWebContents = import('electron').WebContents;

const state = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
  runtimeMeta: new Map<string, { visible?: boolean }>(),
  managedWebContents: null as unknown,
  managedVisibility: null as { visible: boolean; minimized: boolean } | null,
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
      : state.managedWebContents,
  createManagedSession: vi.fn(async () => ({
    sessionId: 'managed-m1',
    webContents: state.managedWebContents,
  })),
  closeManagedSession: vi.fn(),
  closeOwnedSession: vi.fn(),
  navigateWebContents: vi.fn(async () => undefined),
  getManagedWindowVisibility: () => state.managedVisibility,
}));

vi.mock('../../electron/main/services/sclaw-embed-browser-runtime', () => ({
  getSclawEmbedBrowserNetworkLog: () => [],
  getSclawEmbedBrowserRuntime: (runtimeId: string) => state.runtimeMeta.get(runtimeId) ?? null,
}));

let fakeId = 100;

function createFakeWebContents() {
  fakeId += 1;
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
    sendCommand: vi.fn(async () => ({})),
  });
  const executeJavaScript = vi.fn(async (script: string): Promise<unknown> => {
    if (script.includes('.act(')) return { success: true, action: 'click' };
    return {
      url: 'https://example.com/',
      title: 'Example',
      timestamp: Date.now(),
      elements: [],
      fingerprint: 'fp',
      navEpoch: 'epochA',
    };
  });
  const wc = {
    id: fakeId,
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(() => 'Example'),
    executeJavaScript,
    debugger: fakeDebugger,
    getZoomFactor: vi.fn(() => 1),
  } as unknown as FakeWebContents;
  return { wc, executeJavaScript };
}

beforeEach(() => {
  state.webContentsByRuntime.clear();
  state.runtimeMeta.clear();
  state.managedWebContents = null;
  state.managedVisibility = null;
  vi.clearAllMocks();
});

describe('B7 可见性守卫（assertPageActionable）', () => {
  it('负例：embed 上报 visible=false → click fail-fast PAGE_NOT_VISIBLE，不触碰页面、不计 step', async () => {
    const { wc, executeJavaScript } = createFakeWebContents();
    state.webContentsByRuntime.set('hidden', wc);
    state.runtimeMeta.set('hidden', { visible: false }); // D1 上报不可见

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'hidden' });

    const result = await service.act(
      'embed-hidden',
      { action: 'click', ref: '@e1', snapshot: false },
      'run-v1',
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PAGE_NOT_VISIBLE');
    expect(result.error).toContain('不可见');
    expect(executeJavaScript).not.toHaveBeenCalled(); // fail-fast：连 observationBefore 都不做
    expect(repoMock.upsertStepRun).not.toHaveBeenCalled();
  });

  it('负例：embed 不可见时 fill（真实输入类）同样被拒', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('hidden2', wc);
    state.runtimeMeta.set('hidden2', { visible: false });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'hidden2' });

    const result = await service.act('embed-hidden2', { action: 'fill', ref: '@e1', value: 'x', snapshot: false });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PAGE_NOT_VISIBLE');
  });

  it('embed visible=true → click 正常执行', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('shown', wc);
    state.runtimeMeta.set('shown', { visible: true });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'shown' });

    const result = await service.act('embed-shown', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.success).toBe(true);
  });

  it('embed meta 未上报 visible（undefined）→ 按可见放行（灰度兼容）', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('legacy', wc);
    state.runtimeMeta.set('legacy', {}); // 旧渲染层：从未上报

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'legacy' });

    const result = await service.act('embed-legacy', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.success).toBe(true);
  });

  it('负例：managed 窗口最小化 → PAGE_NOT_VISIBLE', async () => {
    const { wc } = createFakeWebContents();
    state.managedWebContents = wc;
    state.managedVisibility = { visible: true, minimized: true };

    const service = new BrowserAutomationService();
    await service.createSession({ url: 'https://example.com/', showManaged: true });

    const result = await service.act('managed-m1', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PAGE_NOT_VISIBLE');
  });

  it('负例：managed 窗口不可见（show 后被 hide）→ PAGE_NOT_VISIBLE', async () => {
    const { wc } = createFakeWebContents();
    state.managedWebContents = wc;
    state.managedVisibility = { visible: false, minimized: false };

    const service = new BrowserAutomationService();
    await service.createSession({ url: 'https://example.com/', showManaged: true });

    const result = await service.act('managed-m1', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.errorCode).toBe('PAGE_NOT_VISIBLE');
  });

  it('headless 豁免：showManaged:false 的离屏窗口属预期不可见，守卫放行', async () => {
    const { wc } = createFakeWebContents();
    state.managedWebContents = wc;
    state.managedVisibility = { visible: false, minimized: false }; // 离屏窗口必然不可见

    const service = new BrowserAutomationService();
    await service.createSession({ url: 'https://example.com/', showManaged: false });

    const result = await service.act('managed-m1', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.success).toBe(true);
  });

  it('navigate 非真实输入类：embed 不可见时仍允许（不受守卫约束）', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('nav-hidden', wc);
    state.runtimeMeta.set('nav-hidden', { visible: false });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'nav-hidden' });

    const result = await service.act(
      'embed-nav-hidden',
      { action: 'navigate', url: 'https://example.com/next', snapshot: false },
    );
    expect(result.success).toBe(true);
  });
});
