/**
 * outbox-flusher — 客户端→服务端单向同步（spec §整体数据流 step 6 + G7/G9）。
 *
 * - 按 id asc（=created_at FIFO）取 pending，按 run 分组推送 POST /agent/v2/runs/{id}/sync。
 * - 成功 → markOutboxSynced；失败 → attempts++ + 指数退避 next_retry_at，超 max_attempts → failed。
 * - 401（stoToken 过期）→ 暂停整个 flush + onTokenExpired 广播 auth:token-expired（长 run 期间 token 过期，退避无效）。
 * - 执行不阻塞同步：执行循环只写本地 + outbox，flusher 独立异步推送。
 *
 * per-entity FIFO（G7）：listPendingOutbox 按 id asc 返回，同一 entity 的多条按创建顺序推送，
 * 防止旧快照（如 node RUNNING）覆盖新快照（node SUCCEEDED）。
 */
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';
import { workflowExecLog } from './logging';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';

const MAX_ATTEMPTS = 8;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextRetry = (a: number) => formatShanghaiIso(Date.now() + Math.min(3_600_000, 2000 * 2 ** a));

export interface FlushDeps {
  repo: WorkflowRuntimeRepository;
  postSync: (runId: string, entries: any[]) => Promise<any>;
  onTokenExpired?: () => void;  // 广播 auth:token-expired（像 auth-store.ts:219）→ 跳登录
}

let running = false;
let activeFlush: Promise<void> | null = null;
export function startFlushLoop(deps: FlushDeps): void {
  if (running) return;
  running = true;
  workflowExecLog('info', 'sync-loop-start', 'workflow outbox flush loop started');
  void loop(deps);
}
export function stopFlushLoop(): void {
  running = false;
  workflowExecLog('info', 'sync-loop-stop', 'workflow outbox flush loop stopped');
}
async function loop(deps: FlushDeps): Promise<void> {
  while (running) {
    try {
      await flushOnce(deps);
    } catch (e) {
      // 单轮异常不应退出循环
      workflowExecLog('warn', 'sync-loop-error', 'workflow outbox flush loop iteration failed', { error: e instanceof Error ? e.message : String(e) });
    }
    await sleep(2_000);
  }
}

export async function flushOnce(deps: FlushDeps): Promise<void> {
  // The periodic loop and an explicit terminal-state flush can arrive together.
  // Serialize them so one outbox row is never posted twice concurrently.
  if (activeFlush) return activeFlush;
  const flush = flushOnceUnsafe(deps);
  activeFlush = flush;
  try {
    await flush;
  } finally {
    if (activeFlush === flush) activeFlush = null;
  }
}

async function flushOnceUnsafe(deps: FlushDeps): Promise<void> {
  const pending = await deps.repo.listPendingOutbox(200); // id asc = FIFO
  if (!pending.length) return;
  workflowExecLog('debug', 'sync-pending', 'workflow outbox pending entries loaded', { pendingCount: pending.length });

  // 按 run 分组，保证同一 run 的 entries 一批推送（减少往返 + 终态锁判定一致）
  const byRun = new Map<string, any[]>();
  for (const e of pending) {
    const arr = byRun.get(e.run_id) ?? [];
    arr.push(e);
    byRun.set(e.run_id, arr);
  }

  for (const [runId, entries] of byRun) {
    const batch = entries.map((e: any) => ({
      entity_type: e.entity_type,
      entity_ref: e.entity_ref,
      payload: safeParse(e.payload),
      sync_kind: e.sync_kind,
    }));
    const ids = entries.map((e: any) => e.id);
    try {
      workflowExecLog('info', 'sync-batch-start', 'syncing workflow outbox batch', { runId, entryCount: batch.length, outboxIds: ids.join(',') });
      await deps.postSync(runId, batch);
      await deps.repo.markOutboxSynced(ids);
      workflowExecLog('info', 'sync-batch-succeeded', 'workflow outbox batch synced', { runId, entryCount: batch.length, outboxIds: ids.join(',') });
    } catch (e: any) {
      if (e?.status === 401 || e?.statusCode === 401) {
        // stoToken 过期：退避重试无效，暂停整个 flush + 广播 token-expired（G9）
        workflowExecLog('warn', 'sync-token-expired', 'workflow outbox sync paused by token expiry', { runId, entryCount: batch.length });
        deps.onTokenExpired?.();
        return;
      }
      // 指数退避；超 max_attempts → 标 failed（不再重试）
      const maxAttempt = Math.max(...entries.map((x: any) => x.attempts ?? 0));
      if (maxAttempt + 1 >= MAX_ATTEMPTS) {
        await deps.repo.markOutboxFailed(ids).catch(() => {});
        workflowExecLog('error', 'sync-batch-failed-final', 'workflow outbox batch exceeded retry limit', {
          runId,
          entryCount: batch.length,
          outboxIds: ids.join(','),
          attempts: maxAttempt + 1,
          error: e instanceof Error ? e.message : String(e),
        });
      } else {
        await deps.repo.bumpOutboxAttempts(ids, nextRetry(maxAttempt));
        workflowExecLog('warn', 'sync-batch-failed-retry', 'workflow outbox batch sync failed; retry scheduled', {
          runId,
          entryCount: batch.length,
          outboxIds: ids.join(','),
          attempts: maxAttempt + 1,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
