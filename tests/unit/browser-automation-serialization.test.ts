// @vitest-environment node
/**
 * 波次 1 · B4 同会话串行化（计划 §七 browser-automation-serialization.test.ts）：
 * - 同会话并发 act × 10 顺序执行、互不交错（P0-6）；
 * - 一棒失败不断链（后续任务照常执行）；
 * - 跨会话不互斥（per-session 队列）。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

type FakeWebContents = import('electron').WebContents;

const state = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
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
  getSclawEmbedBrowserRuntime: () => ({ visible: true }),
}));

let fakeId = 0;

function createFakeWebContents(execImpl: (script: string) => Promise<unknown>) {
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
  const executeJavaScript = vi.fn(execImpl);
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

function cannedObservation() {
  return {
    url: 'https://example.com/',
    title: 'Example',
    timestamp: Date.now(),
    elements: [],
    fingerprint: 'fp',
    navEpoch: 'epochA',
  };
}

beforeEach(() => {
  state.webContentsByRuntime.clear();
  vi.clearAllMocks();
});

describe('B4 同会话串行化', () => {
  it('同会话并发 act × 10 顺序执行、互不交错', async () => {
    const events: string[] = [];
    const exec = async (script: string): Promise<unknown> => {
      const isActCall = script.includes('window.__stoBrowserAutomation.act(');
      const actMatch = isActCall ? script.match(/"name":"(t\d+)"/) : null;
      const tag = actMatch ? `act:${actMatch[1]}` : isActCall ? 'act' : 'observe';
      events.push(`enter:${tag}`);
      // 随机延迟放大交错机会：若未串行化，enter/exit 必然穿插
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)));
      events.push(`exit:${tag}`);
      if (isActCall) return { success: true, action: 'click', occluded: false };
      if (script.includes('window.__stoBrowserAutomation.readClickProbe(')) {
        return { delivered: true, targetMatched: true };
      }
      if (script.includes('window.__stoBrowserAutomation.installClickProbe(')) return true;
      return cannedObservation();
    };
    const { wc } = createFakeWebContents(exec);
    state.webContentsByRuntime.set('ser', wc);

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'ser' });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.act('embed-ser', { action: 'click', name: `t${i}`, snapshot: false })),
    );
    expect(results.every((r) => r.success)).toBe(true);

    // 严格成对：每个 enter 紧随其 exit（串行化下不存在第三个事件穿插）
    expect(events.length).toBeGreaterThan(0);
    expect(events.length % 2).toBe(0);
    for (let i = 0; i < events.length; i += 2) {
      const enter = events[i];
      expect(enter.startsWith('enter:')).toBe(true);
      expect(events[i + 1]).toBe(`exit:${enter.slice('enter:'.length)}`);
    }
    // 每个 act = observationBefore + 探针 + JS click；串行化只要求 act 调用恰好 10 次且成对
    expect(events.filter((e) => e.startsWith('enter:act:'))).toHaveLength(10);
  });

  it('一棒失败不断链：前一个 act 抛错后，后续 act 照常执行', async () => {
    const exec = async (script: string): Promise<unknown> => {
      if (script.includes('"boom"')) {
        throw new Error('page exploded');
      }
      if (script.includes('.act(')) return { success: true, action: 'click' };
      return cannedObservation();
    };
    const { wc } = createFakeWebContents(exec);
    state.webContentsByRuntime.set('chain', wc);

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'chain' });

    const results = await Promise.allSettled([
      service.act('embed-chain', { action: 'click', name: 'boom', snapshot: false }),
      service.act('embed-chain', { action: 'click', name: 'ok', snapshot: false }),
      service.observe('embed-chain'),
    ]);

    expect(results[0].status).toBe('rejected');
    expect((results[0] as PromiseRejectedResult).reason.message).toContain('page exploded');
    expect(results[1].status).toBe('fulfilled');
    expect((results[1] as PromiseFulfilledResult<{ success: boolean }>).value.success).toBe(true);
    expect(results[2].status).toBe('fulfilled');
    expect(
      (results[2] as PromiseFulfilledResult<{ documentGeneration: number }>).value.documentGeneration,
    ).toBeGreaterThan(0);
  });

  it('跨会话不互斥：会话 A 阻塞时，会话 B 的 act 照常完成', async () => {
    let releaseA!: () => void;
    let actAStarted!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const actAEntered = new Promise<void>((resolve) => {
      actAStarted = resolve;
    });

    const execA = async (script: string): Promise<unknown> => {
      if (script.includes('.act(')) {
        actAStarted();
        await gateA; // A 的 act 脚本执行被闸住
        return { success: true, action: 'click' };
      }
      return cannedObservation();
    };
    const execB = async (script: string): Promise<unknown> => {
      if (script.includes('.act(')) return { success: true, action: 'click' };
      return cannedObservation();
    };

    state.webContentsByRuntime.set('sessA', createFakeWebContents(execA).wc);
    state.webContentsByRuntime.set('sessB', createFakeWebContents(execB).wc);

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'sessA' });
    await service.createSession({ embedRuntimeId: 'sessB' });

    const pA = service.act('embed-sessA', { action: 'click', name: 'slowA', snapshot: false });
    await actAEntered; // 确认 A 已进入 act 执行（占住自己的队列）

    const resultB = await service.act('embed-sessB', { action: 'click', name: 'fastB', snapshot: false });
    expect(resultB.success).toBe(true); // B 未被 A 阻塞

    releaseA();
    const resultA = await pA;
    expect(resultA.success).toBe(true);
  });
});
