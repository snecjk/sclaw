import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { computeNextRunAt } from '../services/claude-task-scheduler';
import { logger } from './logger';

/**
 * Gateway cron job 的最小子集（与 electron/api/routes/cron.ts 的 GatewayCronJob 对齐）。
 * 只取清扫需要的字段，避免与完整类型耦合。
 */
interface CronJobSnapshot {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string };
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
  };
}

interface CronJobsDocument {
  jobs?: CronJobSnapshot[];
}

/**
 * 启动期清扫 openclaw（Gateway 引擎）的 cron 任务：
 * 把关机期间错过（nextRunAtMs 落在过去）的 job 推进到未来执行时刻，
 * 顺手清掉崩溃残留的 runningAtMs（Gateway 本身也会在 STUCK_RUN_MS 后自愈，这里只是立刻愈合）。
 *
 * 必须在新 Gateway spawn 之前调用，让新进程一启动 runMissedJobs 就发现
 * 没有任何 nextRunAtMs 落在过去 → 不补跑。产品要求：关机期间错过的任务丢弃，不补跑。
 *
 * 注：StoClaw 平时从不直接写 jobs.json（都走 Gateway RPC），这里是唯一一处直接改写，
 * 因此只动 state 字段、保留文档其余结构，并用 tmp+rename 原子写回。
 */
export async function advanceOpenClawCronNextRuns(now = new Date()): Promise<void> {
  const jobsPath = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
  let raw: string;
  try {
    raw = await readFile(jobsPath, 'utf8');
  } catch {
    // 没有 jobs.json（从未创建过 cron 任务）——无需清扫。
    return;
  }

  let data: CronJobsDocument;
  try {
    data = JSON.parse(raw) as CronJobsDocument;
  } catch (err) {
    logger.warn('[openclaw-cron] jobs.json 解析失败，跳过启动期清扫', err);
    return;
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const nowMs = now.getTime();
  let changed = false;
  const advancedIds: string[] = [];
  const healedIds: string[] = [];

  for (const job of jobs) {
    if (!job?.enabled || job.schedule?.kind !== 'cron' || !job.schedule.expr) continue;
    job.state = job.state ?? {};

    const overdue = typeof job.state.nextRunAtMs === 'number' && job.state.nextRunAtMs <= nowMs;
    const crashed = typeof job.state.runningAtMs === 'number';

    if (overdue) {
      job.state.nextRunAtMs = new Date(computeNextRunAt(job.schedule.expr, now)).getTime();
      advancedIds.push(job.id ?? '?');
      changed = true;
    }
    if (crashed) {
      // 可选：立刻愈合，省去 Gateway STUCK_RUN_MS 自愈等待。
      job.state.runningAtMs = undefined;
      healedIds.push(job.id ?? '?');
      changed = true;
    }
  }

  if (!changed) return;

  await mkdir(dirname(jobsPath), { recursive: true });
  const tmpPath = `${jobsPath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmpPath, jobsPath);
  logger.info('[openclaw-cron] discarded missed runs on startup', {
    advancedIds,
    healedIds,
  });
}
