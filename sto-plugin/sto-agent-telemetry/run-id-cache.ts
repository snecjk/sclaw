/**
 * OpenClaw 0322 的 before_prompt_build / agent_end 不传 runId，
 * 但 before_tool_call 会传（仅本地 hook，不再 POST 上报）。
 * 用 sessionKey 缓存 runId，并延迟上报 model_call_started / model_call_ended，
 * 使模型步与工具步落在同一 run_id。
 */

export type PendingModelCall = {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  channelId?: string;
  event: unknown;
  ctx: {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    channelId?: string;
  };
};

export type PendingModelEnded = {
  sessionId: string;
  sessionKey?: string;
  event: unknown;
  ctx: {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    channelId?: string;
  };
  durationMs?: number;
};

const runIdBySessionKey = new Map<string, string>();
const pendingModelCallsBySessionKey = new Map<string, PendingModelCall[]>();
const pendingModelEndedBySessionKey = new Map<string, PendingModelEnded[]>();

export function rememberRunId(sessionKey: string | undefined, runId: string | undefined): void {
  const key = sessionKey?.trim();
  const id = runId?.trim();
  if (!key || !id) return;
  runIdBySessionKey.set(key, id);
}

export function getCachedRunId(sessionKey: string | undefined): string | undefined {
  const key = sessionKey?.trim();
  if (!key) return undefined;
  return runIdBySessionKey.get(key);
}

export function queuePendingModelCall(sessionKey: string, pending: PendingModelCall): void {
  const key = sessionKey.trim();
  if (!key) return;
  const list = pendingModelCallsBySessionKey.get(key);
  if (list) {
    list.push(pending);
  } else {
    pendingModelCallsBySessionKey.set(key, [pending]);
  }
}

export function takePendingModelCalls(sessionKey: string | undefined): PendingModelCall[] {
  const key = sessionKey?.trim();
  if (!key) return [];
  const list = pendingModelCallsBySessionKey.get(key) ?? [];
  pendingModelCallsBySessionKey.delete(key);
  return list;
}

/** 取队首一条 pending model start（0322 llm_output 与 before_prompt_build 一一配对） */
export function shiftPendingModelCall(sessionKey: string | undefined): PendingModelCall | undefined {
  const key = sessionKey?.trim();
  if (!key) return undefined;
  const list = pendingModelCallsBySessionKey.get(key);
  if (!list || list.length === 0) return undefined;
  const item = list.shift()!;
  if (list.length === 0) {
    pendingModelCallsBySessionKey.delete(key);
  }
  return item;
}

export function queuePendingModelEnded(sessionKey: string, pending: PendingModelEnded): void {
  const key = sessionKey.trim();
  if (!key) return;
  const list = pendingModelEndedBySessionKey.get(key);
  if (list) {
    list.push(pending);
  } else {
    pendingModelEndedBySessionKey.set(key, [pending]);
  }
}

export function takePendingModelEnded(sessionKey: string | undefined): PendingModelEnded[] {
  const key = sessionKey?.trim();
  if (!key) return [];
  const list = pendingModelEndedBySessionKey.get(key) ?? [];
  pendingModelEndedBySessionKey.delete(key);
  return list;
}

export function clearSessionRunCache(sessionKey: string | undefined): void {
  const key = sessionKey?.trim();
  if (!key) return;
  runIdBySessionKey.delete(key);
  pendingModelCallsBySessionKey.delete(key);
  pendingModelEndedBySessionKey.delete(key);
}

/** 测试用 */
export function resetRunIdCacheForTest(): void {
  runIdBySessionKey.clear();
  pendingModelCallsBySessionKey.clear();
  pendingModelEndedBySessionKey.clear();
}
