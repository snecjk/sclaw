import { listBridgeAiRunsForApp } from './bridge-ai-registry';

interface MinuteWindow {
  windowStart: number;
  count: number;
}

const minuteWindows = new Map<string, MinuteWindow>();

function minuteKey(appId: string): string {
  return appId.trim().toLowerCase() || '__unknown__';
}

function currentMinuteCount(appId: string): number {
  const key = minuteKey(appId);
  const now = Date.now();
  const current = minuteWindows.get(key);
  if (!current || now - current.windowStart >= 60_000) {
    minuteWindows.set(key, { windowStart: now, count: 0 });
    return 0;
  }
  return current.count;
}

function incrementMinuteCount(appId: string): void {
  const key = minuteKey(appId);
  const now = Date.now();
  const current = minuteWindows.get(key);
  if (!current || now - current.windowStart >= 60_000) {
    minuteWindows.set(key, { windowStart: now, count: 1 });
    return;
  }
  current.count += 1;
}

export type BridgeAiQuotaAcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; code: 'AI_QUOTA_EXCEEDED' | 'AI_CONCURRENCY_EXCEEDED' };

export function acquireBridgeAiQuota(input: {
  appId: string;
  perMinute: number;
  concurrent: number;
  sessionKey?: string;
}): BridgeAiQuotaAcquireResult {
  const activeRuns = listBridgeAiRunsForApp(input.appId);
  if (activeRuns.length >= input.concurrent) {
    return { ok: false, code: 'AI_CONCURRENCY_EXCEEDED' };
  }
  if (input.sessionKey) {
    const sameSession = activeRuns.some((run) => run.sessionKey === input.sessionKey);
    if (sameSession) {
      return { ok: false, code: 'AI_CONCURRENCY_EXCEEDED' };
    }
  }

  const used = currentMinuteCount(input.appId);
  if (used >= input.perMinute) {
    return { ok: false, code: 'AI_QUOTA_EXCEEDED' };
  }

  incrementMinuteCount(input.appId);
  return { ok: true, release: () => {} };
}

export function resetBridgeAiQuotaForTests(): void {
  minuteWindows.clear();
}
