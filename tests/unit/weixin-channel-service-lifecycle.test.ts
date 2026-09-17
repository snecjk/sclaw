import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWeixinBinding: vi.fn(),
  kill: vi.fn(),
  fork: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/binding', () => ({
  ensureWeixinCredentialsMigrated: vi.fn(),
  getBoundWeixinAccountId: vi.fn().mockReturnValue(null),
  getWeixinBinding: mocks.getWeixinBinding,
  upsertWeixinBinding: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/bridge-inbound', () => ({
  handleWeixinWireEvent: vi.fn(),
}));

vi.mock('@electron/message-channel/weixin/runtime/fork-options', () => ({
  buildWeixinUtilityForkOptions: () => ({}),
}));

vi.mock('@electron/message-channel/weixin/runtime/transport/account-store', () => ({
  resolvePrimaryAccount: () => null,
}));

vi.mock('@electron/message-channel/weixin/runtime/transport/state-dir', () => ({
  resolveWeixinStateDir: () => '/tmp/weixin-test',
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const child = {
    kill: mocks.kill,
    postMessage: vi.fn(),
    on: (event: string, cb: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return child;
    },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    __emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers.get(event) ?? []) cb(...args);
    },
    __reset: () => handlers.clear(),
  };
  mocks.fork.mockImplementation(() => {
    child.__reset();
    return child;
  });
  return {
    app: {
      getPath: () => '/tmp',
      getAppPath: () => '/tmp/app',
    },
    utilityProcess: {
      fork: mocks.fork,
    },
    __child: child,
  };
});

describe('WeixinChannelService lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.getWeixinBinding.mockResolvedValue({
      channelType: 'wechat',
      accountId: 'bot-1',
      agentId: 'main',
      engineType: 'pi',
      enabled: true,
    });
  });

  it('disposeChild kills the process and clears state', async () => {
    const electron = await import('electron') as typeof import('electron') & {
      __child: { __emit: (e: string, ...a: unknown[]) => void };
    };
    const {
      WeixinChannelService,
      __resetWeixinChannelServiceForTests,
    } = await import('@electron/message-channel/weixin/service');
    __resetWeixinChannelServiceForTests();

    const svc = new WeixinChannelService();
    const readyPromise = (svc as unknown as { startChild: () => Promise<void> }).startChild();
    queueMicrotask(() => {
      electron.__child.__emit('message', { type: 'runtime.ready' });
    });
    await readyPromise;
    expect(svc.isReady()).toBe(true);

    svc.disposeChild();
    expect(mocks.kill).toHaveBeenCalled();
    expect(svc.isReady()).toBe(false);
  });

  it('ready timeout disposes the child', async () => {
    vi.useFakeTimers();
    try {
      const {
        WeixinChannelService,
        __resetWeixinChannelServiceForTests,
      } = await import('@electron/message-channel/weixin/service');
      __resetWeixinChannelServiceForTests();
      const svc = new WeixinChannelService();
      const startPromise = (svc as unknown as { startChild: () => Promise<void> }).startChild();
      const rejection = expect(startPromise).rejects.toThrow(/ready timed out/);
      await vi.advanceTimersByTimeAsync(16_000);
      await rejection;
      expect(mocks.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules post-ready restart when still bound; skips when unbound', async () => {
    vi.useFakeTimers();
    try {
      const electron = await import('electron') as typeof import('electron') & {
        __child: { __emit: (e: string, ...a: unknown[]) => void };
      };
      const {
        WeixinChannelService,
        __resetWeixinChannelServiceForTests,
      } = await import('@electron/message-channel/weixin/service');
      __resetWeixinChannelServiceForTests();

      const svc = new WeixinChannelService();
      const startSpy = vi.spyOn(svc, 'start').mockResolvedValue(undefined);

      const readyPromise = (svc as unknown as { startChild: () => Promise<void> }).startChild();
      queueMicrotask(() => {
        electron.__child.__emit('message', { type: 'runtime.ready' });
      });
      await readyPromise;

      electron.__child.__emit('exit', 1);
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      expect(startSpy).toHaveBeenCalled();

      startSpy.mockClear();
      mocks.getWeixinBinding.mockResolvedValue(null);
      __resetWeixinChannelServiceForTests();
      const svc2 = new WeixinChannelService();
      const startSpy2 = vi.spyOn(svc2, 'start').mockResolvedValue(undefined);
      const ready2 = (svc2 as unknown as { startChild: () => Promise<void> }).startChild();
      queueMicrotask(() => {
        electron.__child.__emit('message', { type: 'runtime.ready' });
      });
      await ready2;
      electron.__child.__emit('exit', 1);
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      expect(startSpy2).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
