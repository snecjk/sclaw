// @vitest-environment node
/**
 * 波次 1 · B4 代际校验（计划 §七 browser-automation-generation.test.ts）：
 * - observe 成功时 generation 递增并写入 observation.documentGeneration（覆盖波次 0 的 0 占位）；
 * - 负例：act 携带旧 generation → STALE_REF（不重试、不计 step）；
 * - 灰度期 generation 缺省放行；
 * - navEpoch 变化（静默导航/crash）触发换代 + 递增；
 * - 动作后自动快照（300ms）与快照失败降级；
 * - upsertStepRun 的 observationJson 改存摘要（防 ba_step_run 膨胀，§六 R8）。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

type FakeWebContents = import('electron').WebContents;

// ── 可操控的测试状态（hoisted 供 vi.mock 工厂引用）──
const state = vi.hoisted(() => ({
  navEpoch: 'epochA',
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

interface FakeWcBundle {
  wc: FakeWebContents;
  executeJavaScript: ReturnType<typeof vi.fn>;
  fakeDebugger: EventEmitter & {
    isAttached: ReturnType<typeof vi.fn>;
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
}

function cannedObservation() {
  return {
    url: 'https://example.com/',
    title: 'Example',
    timestamp: Date.now(),
    elements: [
      {
        ref: '@e1',
        stableKey: 'k1',
        role: 'button',
        name: 'OK',
        tag: 'button',
        selector: '#ok',
        clickable: true,
        editable: false,
        states: [],
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    fingerprint: `fp-${state.navEpoch}`,
    navEpoch: state.navEpoch,
  };
}

/** 默认页内脚本执行桩：observe 脚本返回罐头观察（携带可控 navEpoch）；act 脚本返回成功。 */
function defaultExecImpl(script: string): Promise<unknown> {
  if (script.includes('.act(')) {
    return Promise.resolve({ success: true, action: 'click' });
  }
  return Promise.resolve(cannedObservation());
}

function createFakeWebContents(
  id: number,
  execImpl: (script: string) => Promise<unknown> = defaultExecImpl,
): FakeWcBundle {
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
  const executeJavaScript = vi.fn(execImpl);
  const wc = {
    id,
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(() => 'Example'),
    executeJavaScript,
    debugger: fakeDebugger,
    getZoomFactor: vi.fn(() => 1),
  } as unknown as FakeWebContents;
  return { wc, executeJavaScript, fakeDebugger };
}

function setupSession(service: BrowserAutomationService, runtimeId = 'r1', bundle?: FakeWcBundle) {
  const fake = bundle ?? createFakeWebContents(1);
  state.webContentsByRuntime.set(runtimeId, fake.wc);
  state.runtimeMeta.set(runtimeId, { visible: true });
  return fake;
}

beforeEach(() => {
  state.navEpoch = 'epochA';
  state.webContentsByRuntime.clear();
  state.runtimeMeta.clear();
  vi.clearAllMocks();
});

describe('B4 代际校验（documentGeneration）', () => {
  it('observe 成功时 generation 递增并写入 observation（覆盖 0 占位），且不对外泄漏 navEpoch', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });

    const first = await service.observe('embed-r1');
    expect(first.documentGeneration).toBe(1);
    expect(first.observationMode).toBe('dom');
    expect((first as { navEpoch?: unknown }).navEpoch).toBeUndefined();

    const second = await service.observe('embed-r1');
    expect(second.documentGeneration).toBe(2);
  });

  it('act 携带当前 generation 成功执行', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1'); // gen 1

    const result = await service.act('embed-r1', { action: 'click', ref: '@e1', generation: 1, snapshot: false });
    expect(result.success).toBe(true);
    // observationBefore 也会颁发新代际（snapshot:false 时它就是结果观察）
    expect(result.observation?.documentGeneration).toBe(2);
  });

  it('负例：act 携带旧 generation → STALE_REF，不计 step、不重试', async () => {
    const service = new BrowserAutomationService();
    const { executeJavaScript } = setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1'); // gen 1
    await service.observe('embed-r1'); // gen 2

    const callsBefore = executeJavaScript.mock.calls.length;
    const result = await service.act(
      'embed-r1',
      { action: 'click', ref: '@e1', generation: 1, snapshot: false },
      'run-1',
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('STALE_REF');
    expect(result.error).toContain('重新 ba_observe');
    // 前置失败：不计 step、不触碰页面
    expect(repoMock.upsertStepRun).not.toHaveBeenCalled();
    expect(executeJavaScript.mock.calls.length).toBe(callsBefore);
  });

  it('灰度期：generation 缺省放行（未 observe 过也可 act）', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });

    const result = await service.act('embed-r1', { action: 'click', ref: '@e1', snapshot: false });
    expect(result.success).toBe(true);
    // 灰度 act 内的 observationBefore 颁发首个代际
    expect(result.observation?.documentGeneration).toBe(1);
  });

  it('navEpoch 变化（静默导航/crash）触发换代：旧 generation 的 act → STALE_REF 且计数已递增', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1'); // gen 1, epochA

    state.navEpoch = 'epochB'; // 页面静默导航/重载

    const stale = await service.act('embed-r1', { action: 'click', ref: '@e1', generation: 1, snapshot: false });
    expect(stale.success).toBe(false);
    expect(stale.errorCode).toBe('STALE_REF');
    // 换代随 observationBefore 颁发新代际，并附新 observation 供客户端直接续用
    expect(stale.observation?.documentGeneration).toBe(2);

    const next = await service.observe('embed-r1');
    expect(next.documentGeneration).toBe(3);
  });
});

describe('B4 动作后自动快照与 step 摘要', () => {
  it('snapshot 默认开启：延迟 300ms 后追加 observe 附在结果里', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1'); // gen 1

    const started = Date.now();
    const result = await service.act('embed-r1', { action: 'click', ref: '@e1', generation: 1 });
    expect(result.success).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    // observationBefore(gen2) → 快照 observe(gen3)
    expect(result.observation?.documentGeneration).toBe(3);
  });

  it('快照失败降级为动作前观察，不拖垮主动作', async () => {
    const service = new BrowserAutomationService();
    let iifeOnly = 0;
    const flakyExec = (script: string): Promise<unknown> => {
      if (script.trim().endsWith('})()')) {
        iifeOnly += 1;
        if (iifeOnly >= 2) {
          return Promise.reject(new Error('snapshot boom'));
        }
      }
      return defaultExecImpl(script);
    };
    setupSession(service, 'r1', createFakeWebContents(1, flakyExec));
    await service.createSession({ embedRuntimeId: 'r1' });

    const result = await service.act('embed-r1', { action: 'click', ref: '@e1' });
    expect(result.success).toBe(true);
    // 降级回 observationBefore（gen1，灰度 act 内首次观察）
    expect(result.observation?.documentGeneration).toBe(1);
  });

  it('upsertStepRun 的 observationJson 存摘要（url/fingerprint/elementCount/generation），不再全量', async () => {
    const service = new BrowserAutomationService();
    setupSession(service);
    await service.createSession({ embedRuntimeId: 'r1' });
    await service.observe('embed-r1'); // gen 1

    const result = await service.act(
      'embed-r1',
      { action: 'click', ref: '@e1', generation: 1, snapshot: false },
      'run-x',
    );
    expect(result.success).toBe(true);
    expect(repoMock.upsertStepRun).toHaveBeenCalledTimes(1);

    const stepRow = repoMock.upsertStepRun.mock.calls[0][0] as { observationJson?: string };
    const parsed = JSON.parse(String(stepRow.observationJson)) as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(parsed.before).toMatchObject({
      url: 'https://example.com/',
      fingerprint: 'fp-epochA',
      elementCount: 1,
      documentGeneration: 2,
    });
    expect(parsed.after).toMatchObject({ elementCount: 1 });
    // 全量 elements 不再落库
    expect(parsed.before.elements).toBeUndefined();
    expect(parsed.after.elements).toBeUndefined();
  });
});
