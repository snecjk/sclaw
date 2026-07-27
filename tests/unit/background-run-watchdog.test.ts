import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks for the watchdog's direct imports -------------------------------

const isVirtualMock = vi.fn<(key: string) => boolean>();
const setRuntimePatchMock = vi.fn<(set: any, sessionKey: string, patch: any) => void>();
const recordTerminalRunMock = vi.fn<(sessionKey: string, runId: string) => void>();
const getSessionRuntimeStateMock = vi.fn<(map: any, sessionKey: string) => any>();

vi.mock('@/stores/chat/cron-session-utils', () => ({
  isVirtualTaskSessionKey: (k: string) => isVirtualMock(k),
}));
vi.mock('@/stores/chat/runtime-controller', () => ({
  setRuntimePatch: (set: any, sk: string, patch: any) => setRuntimePatchMock(set, sk, patch),
}));
vi.mock('@/stores/chat/run-lifecycle', () => ({
  recordTerminalRun: (sk: string, runId: string) => recordTerminalRunMock(sk, runId),
}));
vi.mock('@/stores/chat/session-runtime', () => ({
  getSessionRuntimeState: (map: any, sk: string) => getSessionRuntimeStateMock(map, sk),
}));

// Fake shared stuck-check timer slot (mirrors runtime-timers set/clear pair).
let stuckTimer: ReturnType<typeof setTimeout> | null = null;
const setStuckCheckTimer = vi.fn((_: string, t: ReturnType<typeof setTimeout> | null) => {
  stuckTimer = t;
});
const clearStuckCheckTimer = vi.fn((_: string) => {
  if (stuckTimer) clearTimeout(stuckTimer);
  stuckTimer = null;
});

describe('background-run-watchdog', () => {
  let runtime: Record<string, any>;
  let get: () => any;
  let set: (fn: (s: any) => any) => void;
  let loadHistory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    runtime = {};
    loadHistory = vi.fn().mockResolvedValue(undefined);
    get = () => ({ runtimeBySessionKey: runtime, loadHistory });
    set = (fn) => fn({ runtimeBySessionKey: runtime });
    getSessionRuntimeStateMock.mockImplementation((_, sk) => runtime[sk]);
    isVirtualMock.mockImplementation((k) => k.startsWith('agent:main:cron:'));
    stuckTimer = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not arm for non-virtual sessions (leaves foreground send-watchdog alone)', async () => {
    const { scheduleBackgroundRunWatchdog } = await import('@/stores/chat/background-run-watchdog');
    scheduleBackgroundRunWatchdog({
      get, set, sessionKey: 'agent:main', runId: 'r1',
      setStuckCheckTimer, clearStuckCheckTimer,
    });
    expect(setStuckCheckTimer).not.toHaveBeenCalled();
  });

  it('clears without patching when the run already terminated (healthy final)', async () => {
    const { scheduleBackgroundRunWatchdog } = await import('@/stores/chat/background-run-watchdog');
    runtime['agent:main:cron:job-1'] = { sending: false, activeRunId: null };
    scheduleBackgroundRunWatchdog({
      get, set, sessionKey: 'agent:main:cron:job-1', runId: 'r1',
      setStuckCheckTimer, clearStuckCheckTimer,
    });
    expect(setStuckCheckTimer).toHaveBeenCalledTimes(1); // armed
    await vi.advanceTimersByTimeAsync(95_000); // well past 90s initial delay
    expect(setRuntimePatchMock).not.toHaveBeenCalled();
    expect(recordTerminalRunMock).not.toHaveBeenCalled();
  });

  it('reschedules while the run is still streaming (no misfire on healthy long task)', async () => {
    const { scheduleBackgroundRunWatchdog, noteBackgroundRunActivity } = await import('@/stores/chat/background-run-watchdog');
    runtime['agent:main:cron:job-1'] = { sending: true, activeRunId: 'r1', streamingMessage: { role: 'assistant' } };
    scheduleBackgroundRunWatchdog({
      get, set, sessionKey: 'agent:main:cron:job-1', runId: 'r1',
      setStuckCheckTimer, clearStuckCheckTimer,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    noteBackgroundRunActivity('agent:main:cron:job-1');
    await vi.advanceTimersByTimeAsync(35_000);
    // Recent activity, rather than a stale streaming snapshot, keeps the run healthy.
    expect(setRuntimePatchMock).not.toHaveBeenCalled();
    expect(recordTerminalRunMock).not.toHaveBeenCalled();
    // Keep refreshing activity (agent-only events) so silence never accumulates.
    for (let i = 0; i < 5; i++) {
      noteBackgroundRunActivity('agent:main:cron:job-1');
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(setRuntimePatchMock).not.toHaveBeenCalled();
  });

  it('forces terminal patch when a run goes silent > 90s with no final (stuck loading)', async () => {
    const { scheduleBackgroundRunWatchdog, noteBackgroundRunActivity } = await import('@/stores/chat/background-run-watchdog');
    const sk = 'agent:main:cron:job-1';
    runtime[sk] = { sending: true, activeRunId: 'r1', streamingMessage: null, streamingText: '', pendingFinal: false, updatedAt: 0 };
    // `started` fired once (activity noted), then the gateway went dark.
    noteBackgroundRunActivity(sk);
    scheduleBackgroundRunWatchdog({
      get, set, sessionKey: sk, runId: 'r1',
      setStuckCheckTimer, clearStuckCheckTimer,
    });
    await vi.advanceTimersByTimeAsync(95_000);
    expect(recordTerminalRunMock).toHaveBeenCalledWith(sk, 'r1');
    expect(setRuntimePatchMock).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledWith(true, true, sk);
    const patch = setRuntimePatchMock.mock.calls[0][2];
    expect(patch.sending).toBe(false);
    expect(patch.activeRunId).toBe(null);
    expect(patch.error).toEqual(expect.any(String));
  });

  it('does not let stale streaming content mask 90 seconds of silence', async () => {
    const { scheduleBackgroundRunWatchdog, noteBackgroundRunActivity } = await import('@/stores/chat/background-run-watchdog');
    const sk = 'agent:main:cron:job-stale-stream';
    runtime[sk] = {
      sending: true,
      activeRunId: 'r-stale',
      streamingMessage: { role: 'assistant', content: 'old partial' },
      streamingText: 'old partial',
      pendingFinal: true,
      updatedAt: 0,
    };
    noteBackgroundRunActivity(sk);
    scheduleBackgroundRunWatchdog({
      get, set, sessionKey: sk, runId: 'r-stale',
      setStuckCheckTimer, clearStuckCheckTimer,
    });

    await vi.advanceTimersByTimeAsync(95_000);

    expect(loadHistory).toHaveBeenCalledWith(true, true, sk);
    expect(recordTerminalRunMock).toHaveBeenCalledWith(sk, 'r-stale');
    expect(setRuntimePatchMock).toHaveBeenCalledTimes(1);
  });
});
