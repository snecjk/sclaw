import {
  canonicalSessionUnreadKey,
} from '@/lib/session-unread-keys';
import { getSessionReadAt, useSessionUnreadStore } from '@/stores/session-unread';

/**
 * 未读红点打标（集中门禁）。
 *
 * 未读的语义 = "我没在看的会话，其运行成功完成了"。历史上这里只用
 * `sessionKey !== currentSessionKey` 判断，导致三类误报：
 *  1. 看完一条又开新对话时，上一条的迟到 final 事件把它误标未读；
 *  2. 重启/重装/刷新后，网关重放的历史完成事件把一批会话误标；
 *  3. 点开清掉后又被重放事件重新标上。
 *
 * 这里用三重门禁消除误报：
 *  A. 已观测 run：只给"本次 App 运行期间真实观测到 started/stream 的 run"打标。
 *     重放的历史完成事件其 runId 未被观测过 → 跳过（治 2、3、刷新）。
 *  B. 启动宽限：模块加载后的前若干秒内不打标，兜底拦截重放突发（治 2/刷新）。
 *  C. 近期已读：会话最近被打开/前台完成过（readAt 在宽限内）→ 跳过（治 1）。
 */

/** 本次 App 运行期间观测到 started/stream 的 runId 集合（不持久化）。 */
const observedRunIds = new Set<string>();
const OBSERVED_RUN_CAP = 800;

/** 模块加载即视为 App/渲染进程启动时刻，用于启动宽限。 */
const moduleLoadedAt = Date.now();
const UNREAD_STARTUP_GRACE_MS = 5_000;

/** 会话最近已读后多久内不再被后台/迟到事件重新打标。 */
const RECENT_READ_GRACE_MS = 20_000;

/** 记录一个本次运行期间真实观测到的 run（在 started/delta 事件处调用）。 */
export function noteObservedRun(runId: string | null | undefined): void {
  if (runId == null) return;
  const id = String(runId).trim();
  if (!id) return;
  observedRunIds.add(id);
  if (observedRunIds.size > OBSERVED_RUN_CAP) {
    // 简单裁剪最早若干项，避免无界增长。
    const it = observedRunIds.values();
    for (let i = 0; i < 200; i++) {
      const n = it.next();
      if (n.done) break;
      observedRunIds.delete(n.value);
    }
  }
}

/** 仅用于测试：重置模块内的观测状态。 */
export function __resetObservedRunsForTest(): void {
  observedRunIds.clear();
}

export interface MarkSessionUnreadOptions {
  /** 完成事件对应的 runId，用于校验 run 是否为本次运行观测到的。 */
  runId?: string | null;
}

export function markSessionUnreadAfterSuccessfulRun(
  sessionKey: string | null | undefined,
  currentSessionKey: string,
  options?: MarkSessionUnreadOptions,
): void {
  if (!sessionKey) return;
  const canonical = canonicalSessionUnreadKey(sessionKey);
  if (!canonical || canonical === currentSessionKey) return;

  // B. 启动宽限：拦截重放突发。
  if (Date.now() - moduleLoadedAt < UNREAD_STARTUP_GRACE_MS) return;

  // A. 已观测 run：无 runId 或未观测到的 run（重放历史）一律跳过。
  const runId = options?.runId != null ? String(options.runId).trim() : '';
  if (!runId || !observedRunIds.has(runId)) return;

  // C. 近期已读：刚看过就离开的会话，不因迟到事件重新打红点。
  const readAt = getSessionReadAt(canonical);
  if (readAt > 0 && Date.now() - readAt < RECENT_READ_GRACE_MS) return;

  useSessionUnreadStore.getState().markSessionUnread(sessionKey);
}
