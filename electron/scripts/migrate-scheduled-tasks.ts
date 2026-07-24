import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import type { ScheduledTaskService } from '../scheduled-tasks/scheduled-task-service';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import type { CreateScheduleTaskInput } from '../db/models/dto/schedule-task.dto';
import {
  getClaudeScheduledTasksDir,
  getOpenClawConfigDir,
  getStoClawHomeDir,
} from '../utils/paths';
import { logger } from '../utils/logger';
import { getAuthState } from '../utils/auth-store';

/**
 * Step 4 数据迁移：把遗留本地 JSON 定时任务（claude `definitions.json` + openclaw
 * `openclaw/cron/jobs.json`）一次性灌入统一 SQLite `schedule_tasks` 表。
 *
 * 幂等：marker 文件 + per-row `getById` 存在检查双闸——进程崩溃可重跑续传。
 *
 * OpenClaw **不依赖 Gateway**：直读/改写 `jobs.json`（路径：
 * `openclaw/cron/jobs.json`）。启动早期即可跑，避免 `cron.list` 在 Gateway
 * 未连接时失败 → 仍写 marker → 永久漏迁。
 *
 * 字段映射原则（两引擎对称）：
 *  - `dingtalkRecipients=null`、prompt **原样保留烘焙块**。
 *  - `next_run_at` 不搬旧 state，建表置 null，末尾 `refreshSchedule` 重算。
 *  - openclaw 非 cron-expr 任务（everyMs/at）跳过且**留在** jobs.json + 告警。
 */

const MARKER_FILENAME = 'scheduled-tasks-migration.done';
const DEFINITIONS_FILENAME = 'definitions.json';

/** claude 旧定义（镜像 `claude-scheduled-task-store.ts` ClaudeScheduledTaskDefinition）。 */
interface ClaudeScheduledTaskDefinition {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile: 'readonly-safe' | 'workspace-write' | 'dangerous-bypass';
  timeoutSec: number;
  workflowCode?: string;
  retryPolicy: { maxAttempts: number; backoffSec: number };
  failurePolicy: { pauseAfterConsecutiveFailures: number };
}

interface ClaudeDefinitionsDocument {
  definitions?: ClaudeScheduledTaskDefinition[];
}

/** openclaw jobs.json 条目（与 Gateway cron job / 磁盘文件 shape 对齐的最小子集）。 */
interface OpenclawCronJob {
  id: string;
  name?: string;
  enabled?: boolean;
  description?: string;
  schedule?: { kind?: string; expr?: string; everyMs?: number; at?: string };
  payload?: { message?: string; text?: string; model?: string };
}

interface OpenclawJobsDocument {
  version?: number;
  jobs?: OpenclawCronJob[];
  [key: string]: unknown;
}

interface OpenclawMigrationResult {
  migrated: number;
  skipped: number;
  nonCron: number;
  /** false：解析失败 / 写回失败 / 有 create 失败未清出 —— 调用方不得 finalized marker */
  complete: boolean;
}

function parseOpenclawDescription(description: unknown): {
  agentId: string | null;
  workflowCode: string | null;
} {
  if (typeof description !== 'string' || description.trim() === '') {
    return { agentId: null, workflowCode: null };
  }
  try {
    const meta = JSON.parse(description) as {
      agentId?: string;
      workflowCode?: string;
    };
    return {
      agentId: meta.agentId?.trim() || null,
      workflowCode: meta.workflowCode?.trim() || null,
    };
  } catch {
    return { agentId: null, workflowCode: null };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function getOpenclawJobsPath(): string {
  return join(getOpenClawConfigDir(), 'cron', 'jobs.json');
}

async function migrateClaudeDefinitions(
  taskRepo: ScheduleTaskRepository,
  actor: string | null,
): Promise<{ migrated: number; skipped: number }> {
  const definitionsFile = join(getClaudeScheduledTasksDir(), DEFINITIONS_FILENAME);
  let definitions: ClaudeScheduledTaskDefinition[] = [];
  try {
    const raw = await readFile(definitionsFile, 'utf8');
    const doc = JSON.parse(raw) as ClaudeDefinitionsDocument;
    definitions = Array.isArray(doc.definitions) ? doc.definitions : [];
  } catch {
    logger.info('[migration] claude definitions.json not found / unreadable — skipping claude');
    return { migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  for (const def of definitions) {
    const existing = await taskRepo.getById(def.id, { includeDeleted: true });
    if (existing) {
      skipped += 1;
      continue;
    }
    const input: CreateScheduleTaskInput = {
      id: def.id,
      name: def.name,
      enabled: def.enabled,
      cronExpr: def.cronExpr,
      engineType: 'claude',
      prompt: def.promptTemplate,
      agentId: def.agentId,
      accountId: def.providerAccountId ?? null,
      workspacePath: def.workspacePath,
      model: def.model ?? null,
      permissionProfile: def.permissionProfile,
      timeoutSec: def.timeoutSec,
      workflowCode: def.workflowCode ?? null,
      retryPolicy: def.retryPolicy,
      failurePolicy: def.failurePolicy,
      dingtalkRecipients: null,
      actor,
    };
    try {
      await taskRepo.create(input);
      migrated += 1;
    } catch (error) {
      logger.warn('[migration] claude task create failed', {
        id: def.id,
        name: def.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info(`[migration] claude: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

/**
 * 直读 `openclaw/cron/jobs.json` → 写入 schedule_tasks → 从文件移除已落地 cron，
 * 防 Gateway 随后启动双调度。不调用 cron.list / cron.remove。
 */
async function migrateOpenclawCronJobs(
  taskRepo: ScheduleTaskRepository,
  actor: string | null,
): Promise<OpenclawMigrationResult> {
  const jobsPath = getOpenclawJobsPath();
  let raw: string;
  try {
    raw = await readFile(jobsPath, 'utf8');
  } catch {
    logger.info('[migration] openclaw jobs.json not found — skipping openclaw');
    return { migrated: 0, skipped: 0, nonCron: 0, complete: true };
  }

  let data: OpenclawJobsDocument;
  try {
    data = JSON.parse(raw) as OpenclawJobsDocument;
  } catch (error) {
    logger.warn('[migration] openclaw jobs.json parse failed — not writing marker', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { migrated: 0, skipped: 0, nonCron: 0, complete: false };
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const removeIds = new Set<string>();
  let migrated = 0;
  let skipped = 0;
  let nonCron = 0;
  let createFailures = 0;

  for (const job of jobs) {
    if (!job?.id) continue;
    const expr = job.schedule?.expr;
    const isCron = job.schedule?.kind === 'cron' || Boolean(expr);
    if (!isCron) {
      nonCron += 1;
      logger.warn('[migration] openclaw job skipped (non-cron schedule, left in jobs.json)', {
        id: job.id,
        name: job.name,
        kind: job.schedule?.kind,
      });
      continue;
    }
    if (!expr) {
      nonCron += 1;
      logger.warn('[migration] openclaw job skipped (no cron expr, left in jobs.json)', {
        id: job.id,
      });
      continue;
    }

    const existing = await taskRepo.getById(job.id, { includeDeleted: true });
    if (existing) {
      skipped += 1;
      removeIds.add(job.id);
      continue;
    }

    const { agentId, workflowCode } = parseOpenclawDescription(job.description);
    const prompt = job.payload?.message || job.payload?.text || '';
    const input: CreateScheduleTaskInput = {
      id: job.id,
      name: job.name || job.id,
      enabled: job.enabled !== false,
      cronExpr: expr,
      engineType: 'openclaw',
      prompt,
      agentId: agentId || 'main',
      workflowCode,
      model: job.payload?.model ?? null,
      dingtalkRecipients: null,
      permissionProfile: null,
      timeoutSec: null,
      accountId: null,
      workspacePath: null,
      retryPolicy: null,
      failurePolicy: null,
      actor,
    };
    try {
      await taskRepo.create(input);
      migrated += 1;
      removeIds.add(job.id);
    } catch (error) {
      createFailures += 1;
      logger.warn('[migration] openclaw task create failed (left in jobs.json)', {
        id: job.id,
        name: job.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (removeIds.size > 0) {
    const remaining = jobs.filter((j) => !j?.id || !removeIds.has(j.id));
    const nextDoc: OpenclawJobsDocument = { ...data, jobs: remaining };
    try {
      await mkdir(dirname(jobsPath), { recursive: true });
      const tmpPath = `${jobsPath}.${randomUUID()}.tmp`;
      await writeFile(tmpPath, JSON.stringify(nextDoc, null, 2), 'utf8');
      await rename(tmpPath, jobsPath);
      logger.info('[migration] openclaw jobs.json rewritten', {
        removed: [...removeIds],
        remaining: remaining.length,
      });
    } catch (error) {
      logger.warn('[migration] openclaw jobs.json rewrite failed — not finalizing marker', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { migrated, skipped, nonCron, complete: false };
    }
  }

  const complete = createFailures === 0;
  logger.info(
    `[migration] openclaw: ${migrated} migrated, ${skipped} skipped, ${nonCron} non-cron skipped` +
      (complete ? '' : ` (${createFailures} create failures)`),
  );
  return { migrated, skipped, nonCron, complete };
}

async function writeMarker(
  markerFile: string,
  claude: { migrated: number; skipped: number },
  openclaw: OpenclawMigrationResult,
): Promise<void> {
  await mkdir(dirname(markerFile), { recursive: true });
  const payload = {
    completedAt: new Date().toISOString(),
    claude,
    openclaw: {
      migrated: openclaw.migrated,
      skipped: openclaw.skipped,
      nonCron: openclaw.nonCron,
    },
  };
  await writeFile(markerFile, JSON.stringify(payload, null, 2), 'utf8');
  logger.info('[migration] marker written', { path: markerFile, payload });
}

/**
 * 一次性迁移入口。在 `setGatewayManager` 之后、`startScheduler` 之前调用。
 * 不要求 Gateway 已连接。
 *
 * - marker 缺失：迁 claude + openclaw → 仅 openclaw complete 时写 marker → refresh。
 * - marker 已在（含历史「openclaw 因 Gateway 未连漏迁」）：仍跑 openclaw 文件补迁；
 *   有新写入则 refresh，并把 marker 更新为完整结果。
 */
export async function runScheduledTasksMigration(
  _gm: GatewayManager,
  service: ScheduledTaskService,
): Promise<void> {
  const markerFile = join(getStoClawHomeDir(), MARKER_FILENAME);
  const markerPresent = await fileExists(markerFile);
  const taskRepo = new ScheduleTaskRepository();

  const { user } = await getAuthState();
  const actor = user?.code ?? null;

  let claudeResult = { migrated: 0, skipped: 0 };
  if (!markerPresent) {
    logger.info('[migration] scheduled-tasks migration starting');
    claudeResult = await migrateClaudeDefinitions(taskRepo, actor);
  } else {
    logger.info(
      '[migration] marker present — skipping claude; checking openclaw jobs.json for leftovers',
    );
  }

  const openclawResult = await migrateOpenclawCronJobs(taskRepo, actor);

  if (!openclawResult.complete) {
    logger.warn('[migration] openclaw incomplete — marker not finalized (will retry next launch)');
    if (claudeResult.migrated > 0 || openclawResult.migrated > 0) {
      await service.refreshSchedule();
      logger.info('[migration] refreshSchedule done (partial)');
    }
    return;
  }

  // 首次跑，或补迁了 openclaw：写/更新 marker
  if (!markerPresent || openclawResult.migrated > 0 || openclawResult.skipped > 0) {
    // skipped>0 且改写了 jobs.json 时也刷新 marker，避免旧 payload 误导排障
    let claudeForMarker = claudeResult;
    if (markerPresent) {
      try {
        const prev = JSON.parse(await readFile(markerFile, 'utf8')) as {
          claude?: { migrated: number; skipped: number };
        };
        if (prev.claude) claudeForMarker = prev.claude;
      } catch {
        // 读旧 marker 失败则用本次 claude 计数（多为 0）
      }
    }
    await writeMarker(markerFile, claudeForMarker, openclawResult);
  } else if (markerPresent) {
    logger.info('[migration] openclaw jobs.json clean — nothing to backfill');
  }

  if (!markerPresent || openclawResult.migrated > 0) {
    await service.refreshSchedule();
    logger.info('[migration] refreshSchedule done — next_run_at recomputed');
  }
}
