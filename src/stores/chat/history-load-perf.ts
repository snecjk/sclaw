import { logChatFlow } from './chat-flow-log';

/** DevTools 过滤：`[chat-history-perf]` */
export const CHAT_HISTORY_PERF_PREFIX = '[chat-history-perf]';

interface HistoryLoadPerfContext {
  sessionKey: string;
  startedAt: number;
  quiet: boolean;
  force: boolean;
  engineType?: string;
  applyStartedAt?: number;
}

const contexts = new Map<string, HistoryLoadPerfContext>();

export function estimateJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function formatPayloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function emit(stage: string, sessionKey: string, detail: Record<string, unknown> = {}): void {
  const ctx = contexts.get(sessionKey);
  const sinceStartMs = ctx ? Math.round(performance.now() - ctx.startedAt) : undefined;
  const payload = {
    sessionKey,
    engineType: ctx?.engineType ?? detail.engineType ?? null,
    quiet: ctx?.quiet ?? detail.quiet ?? null,
    sinceStartMs,
    ...detail,
  };
  console.info(CHAT_HISTORY_PERF_PREFIX, stage, payload);
  logChatFlow(`history.perf.${stage}`, payload);
}

export function startHistoryLoadPerf(input: {
  sessionKey: string;
  quiet: boolean;
  force: boolean;
  engineType?: string;
  cachedTranscriptCount?: number;
}): void {
  contexts.set(input.sessionKey, {
    sessionKey: input.sessionKey,
    startedAt: performance.now(),
    quiet: input.quiet,
    force: input.force,
    engineType: input.engineType,
  });
  emit('load.start', input.sessionKey, {
    quiet: input.quiet,
    force: input.force,
    engineType: input.engineType ?? null,
    cachedTranscriptCount: input.cachedTranscriptCount ?? 0,
  });
}

export function markHistoryLoadPerf(
  sessionKey: string,
  stage: string,
  detail: Record<string, unknown> = {},
): void {
  emit(stage, sessionKey, detail);
}

export function startHistoryApplyPerf(sessionKey: string): void {
  const ctx = contexts.get(sessionKey);
  if (!ctx) return;
  ctx.applyStartedAt = performance.now();
  emit('apply.start', sessionKey);
}

export function markHistoryApplyPerf(
  sessionKey: string,
  stage: string,
  detail: Record<string, unknown> = {},
): void {
  const ctx = contexts.get(sessionKey);
  const applyMs = ctx?.applyStartedAt
    ? Math.round(performance.now() - ctx.applyStartedAt)
    : undefined;
  emit(stage, sessionKey, { applyMs, ...detail });
}

export function finishHistoryLoadPerf(
  sessionKey: string,
  detail: Record<string, unknown> = {},
): void {
  emit('load.done', sessionKey, detail);
  contexts.delete(sessionKey);
}

export function cancelHistoryLoadPerf(
  sessionKey: string,
  reason: string,
  detail: Record<string, unknown> = {},
): void {
  emit('load.cancelled', sessionKey, { reason, ...detail });
  contexts.delete(sessionKey);
}
