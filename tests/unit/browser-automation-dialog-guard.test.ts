// @vitest-environment node
/**
 * 波次 1 · B2 dialog-guard（计划 §七 browser-automation-dialog-guard.test.ts）：
 * - alert/confirm/prompt 三策略应答（auto-dismiss 默认 / auto-accept / record-only 不接管）；
 * - 负例：10 次/5s 触发 DIALOG_STORM 且熔断后 act 被拒（service 层端到端接线）；
 * - 滑动窗口滑过后熔断自动解除；
 * - detach 摘除事件订阅；
 * - CDP Page 域不支持 → 页内 installDialogHooks 降级 + pullPageDialogs 合并记录；
 * - B9：managed 窗口 will-prevent-unload 补丁（beforeunload 不走 javascriptDialogOpening）。
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachDialogGuard,
} from '../../electron/services/browser-automation/dialog-guard';
import type { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';
import {
  BROWSER_AUTOMATION_DIALOG_STORM_LIMIT,
  BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS,
} from '../../shared/browser-automation/types';

// ── fake CDP：捕获事件订阅 + 记录 send 调用 ──
interface FakeGuardCdp {
  cdp: BrowserAutomationCdpSession;
  emit: (method: string, params: unknown) => void;
  sent: Array<{ method: string; params?: Record<string, unknown> }>;
  handlers: Map<string, Set<(params: unknown) => void>>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  enableDomains: ReturnType<typeof vi.fn>;
}

function createGuardCdp(): FakeGuardCdp {
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const executeJavaScript = vi.fn(async () => [] as unknown[]);
  const enableDomains = vi.fn(async () => undefined);
  const cdp = {
    isDestroyed: false,
    rawWebContents: { executeJavaScript },
    enableDomains,
    onCdpEvent: vi.fn((method: string, handler: (params: unknown) => void) => {
      let set = handlers.get(method);
      if (!set) {
        set = new Set();
        handlers.set(method, set);
      }
      set.add(handler);
    }),
    offCdpEvent: vi.fn((method: string, handler: (params: unknown) => void) => {
      handlers.get(method)?.delete(handler);
    }),
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return {};
    }),
  } as unknown as BrowserAutomationCdpSession;
  const emit = (method: string, params: unknown) => {
    for (const handler of handlers.get(method) ?? []) handler(params);
  };
  return { cdp, emit, sent, handlers, executeJavaScript, enableDomains };
}

function dialogSends(fake: FakeGuardCdp) {
  return fake.sent.filter((call) => call.method === 'Page.handleJavaScriptDialog');
}

async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('dialog-guard 策略应答', () => {
  it('默认 auto-dismiss：alert/confirm/prompt 一律 dismiss 并记录', async () => {
    const fake = createGuardCdp();
    const guard = attachDialogGuard(fake.cdp);
    await guard.ready;

    expect(fake.enableDomains).toHaveBeenCalledWith('Page');
    fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hi' });
    fake.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'sure?' });
    fake.emit('Page.javascriptDialogOpening', { type: 'prompt', message: 'name?', defaultPrompt: 'sto' });

    const responses = dialogSends(fake);
    expect(responses).toHaveLength(3);
    expect(responses.every((call) => call.params?.accept === false)).toBe(true);

    const records = guard.drain();
    expect(records.map((r) => r.type)).toEqual(['alert', 'confirm', 'prompt']);
    expect(records.every((r) => r.handled === 'dismissed')).toBe(true);
    expect(records[2].defaultValue).toBe('sto');
    // drain 取走后清空
    expect(guard.drain()).toEqual([]);
  });

  it('auto-accept：confirm/prompt 接受，prompt 透传 defaultPrompt 为 promptText', async () => {
    const fake = createGuardCdp();
    const guard = attachDialogGuard(fake.cdp, { policy: 'auto-accept' });
    await guard.ready;

    fake.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'ok?' });
    fake.emit('Page.javascriptDialogOpening', { type: 'prompt', message: 'v?', defaultPrompt: 'dv' });

    const responses = dialogSends(fake);
    expect(responses[0].params).toEqual({ accept: true });
    expect(responses[1].params).toEqual({ accept: true, promptText: 'dv' });
    expect(guard.drain().every((r) => r.handled === 'accepted')).toBe(true);
  });

  it('record-only：不接管（不应答），仅记录 handled=auto', async () => {
    const fake = createGuardCdp();
    const guard = attachDialogGuard(fake.cdp, { policy: 'record-only' });
    await guard.ready;

    fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'keep-me' });

    expect(dialogSends(fake)).toHaveLength(0);
    const records = guard.drain();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ type: 'alert', message: 'keep-me', handled: 'auto' });
  });

  it('detach 摘除事件订阅：之后的事件不再记录', async () => {
    const fake = createGuardCdp();
    const guard = attachDialogGuard(fake.cdp);
    await guard.ready;
    guard.detach();

    fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'gone' });
    expect(guard.drain()).toEqual([]);
    expect(fake.handlers.get('Page.javascriptDialogOpening')?.size ?? 0).toBe(0);
    expect(fake.handlers.get('Page.javascriptDialogClosed')?.size ?? 0).toBe(0);
  });
});

describe('dialog-guard 风暴熔断', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认阈值 10 次/5s：第 9 次不熔断，第 10 次触发；storming 期间一律 dismiss', async () => {
    const fake = createGuardCdp();
    // auto-accept 策略下观察熔断覆盖行为
    const guard = attachDialogGuard(fake.cdp, { policy: 'auto-accept' });
    await guard.ready;

    for (let i = 0; i < BROWSER_AUTOMATION_DIALOG_STORM_LIMIT - 1; i += 1) {
      fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: `m${i}` });
    }
    expect(guard.isStorming()).toBe(false);

    fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'storm!' });
    expect(guard.isStorming()).toBe(true);

    const responses = dialogSends(fake);
    // 前 9 次按 policy 接受，第 10 次熔断 dismiss
    expect(responses.slice(0, 9).every((call) => call.params?.accept === true)).toBe(true);
    expect(responses[9].params?.accept).toBe(false);
  });

  it('滑动窗口滑过且无新 dialog 后熔断自动解除', async () => {
    const fake = createGuardCdp();
    const guard = attachDialogGuard(fake.cdp, { stormLimit: 3, stormWindowMs: 5_000 });
    await guard.ready;

    for (let i = 0; i < 3; i += 1) {
      fake.emit('Page.javascriptDialogOpening', { type: 'alert', message: `m${i}` });
    }
    expect(guard.isStorming()).toBe(true);

    vi.advanceTimersByTime(BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS + 1);
    expect(guard.isStorming()).toBe(false);
  });
});

describe('dialog-guard 页内降级（CDP Page 域不支持）', () => {
  it('CDP_DOMAIN_UNSUPPORTED → 注入 installDialogHooks fallback，pullPageDialogs 合并页内记录', async () => {
    const fake = createGuardCdp();
    fake.enableDomains.mockRejectedValue(
      Object.assign(new Error("'Page.enable' wasn't found"), { code: 'CDP_DOMAIN_UNSUPPORTED' }),
    );
    const guard = attachDialogGuard(fake.cdp, { policy: 'auto-dismiss' });
    await guard.ready;

    // 页内 fallback 安装（经 rawWebContents.executeJavaScript）
    expect(fake.executeJavaScript).toHaveBeenCalledTimes(1);
    const installScript = String(fake.executeJavaScript.mock.calls[0][0]);
    expect(installScript).toContain('installDialogHooks');
    expect(installScript).toContain('"auto-dismiss"');

    // 页内 drainDialogs 记录并入 buffer
    fake.executeJavaScript.mockResolvedValueOnce([
      { type: 'confirm', message: 'page-side', handled: 'dismissed', at: 123 },
    ]);
    await guard.pullPageDialogs();
    const records = guard.drain();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ type: 'confirm', message: 'page-side', handled: 'dismissed', at: 123 });
  });

  it('非域不支持类错误（如 CDP_TIMEOUT）不触发页内降级', async () => {
    const fake = createGuardCdp();
    fake.enableDomains.mockRejectedValue(
      Object.assign(new Error('slow'), { code: 'CDP_TIMEOUT' }),
    );
    const guard = attachDialogGuard(fake.cdp);
    await guard.ready;

    expect(fake.executeJavaScript).not.toHaveBeenCalled();
    await guard.pullPageDialogs(); // no-op，不抛错
    expect(guard.drain()).toEqual([]);
  });
});

// ── service 层端到端：熔断后 act 被拒（DIALOG_STORM）──

const serviceState = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
}));

const serviceRepoMock = vi.hoisted(() => ({
  upsertSession: vi.fn(async () => undefined),
  createRun: vi.fn(async () => 'run-1'),
  upsertStepRun: vi.fn(async () => undefined),
  listStepRuns: vi.fn(async () => [] as Array<Record<string, unknown>>),
  completeRun: vi.fn(async () => undefined),
}));

vi.mock('../../electron/db/repositories/browser-automation-repository', () => ({
  browserAutomationRepository: serviceRepoMock,
}));

vi.mock('../../electron/services/browser-automation/session-manager', () => ({
  buildEmbedSessionId: (runtimeId: string) => `embed-${runtimeId}`,
  parseEmbedRuntimeId: (sessionId: string) =>
    sessionId.startsWith('embed-') ? sessionId.slice('embed-'.length) || null : null,
  isSessionExpired: () => false,
  logSessionEvent: vi.fn(),
  resolveEmbedWebContents: (runtimeId: string) => serviceState.webContentsByRuntime.get(runtimeId) ?? null,
  resolveSessionWebContents: (session: { source: string; embedRuntimeId?: string }) =>
    session.source === 'embed' && session.embedRuntimeId
      ? serviceState.webContentsByRuntime.get(session.embedRuntimeId) ?? null
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

import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

describe('B4 接线：dialog 风暴熔断后 act 被拒', () => {
  it('10 次 dialog/5s → isStorming → act 直接失败 DIALOG_STORM，不再向页面投递输入', async () => {
    const emitter = new EventEmitter();
    const dbgState = { attached: false };
    const sendCommand = vi.fn(async () => ({}));
    const fakeDebugger = Object.assign(emitter, {
      isAttached: vi.fn(() => dbgState.attached),
      attach: vi.fn(async () => {
        dbgState.attached = true;
      }),
      detach: vi.fn(() => {
        dbgState.attached = false;
      }),
      sendCommand,
    });
    const executeJavaScript = vi.fn(async (script: string) => {
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
      id: 9,
      isDestroyed: vi.fn(() => false),
      isLoading: vi.fn(() => false),
      getURL: vi.fn(() => 'https://example.com/'),
      getTitle: vi.fn(() => 'Example'),
      executeJavaScript,
      debugger: fakeDebugger,
      getZoomFactor: vi.fn(() => 1),
    } as unknown as import('electron').WebContents;
    serviceState.webContentsByRuntime.set('stormy', wc);

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'stormy' });
    // 首次 observe 触发 requireDeps → 挂 dialog 守卫（真实 attachDialogGuard 接线）
    await service.observe('embed-stormy');
    await flushMicrotasks();

    // 模拟 dialog 风暴（经真实 onCdpEvent 订阅链：debugger 'message' → guard）
    for (let i = 0; i < BROWSER_AUTOMATION_DIALOG_STORM_LIMIT; i += 1) {
      fakeDebugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: `x${i}` });
    }
    // 应答经 cdp.send 的 promise 链异步投递，先冲刷
    await flushMicrotasks();
    // 全部 dialog 被 auto-dismiss 应答
    const dialogResponses = sendCommand.mock.calls.filter(
      (call) => call[0] === 'Page.handleJavaScriptDialog',
    );
    expect(dialogResponses).toHaveLength(BROWSER_AUTOMATION_DIALOG_STORM_LIMIT);
    expect(dialogResponses.every((call) => (call[1] as { accept: boolean }).accept === false)).toBe(true);

    const scriptsBefore = executeJavaScript.mock.calls.length;
    const result = await service.act('embed-stormy', { action: 'click', ref: '@e1', snapshot: false });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DIALOG_STORM');
    expect(result.dialogs).toHaveLength(BROWSER_AUTOMATION_DIALOG_STORM_LIMIT);
    // 熔断期间不再向页面投递任何输入/脚本
    expect(executeJavaScript.mock.calls.length).toBe(scriptsBefore);
    expect(serviceRepoMock.upsertStepRun).not.toHaveBeenCalled();
  });
});
