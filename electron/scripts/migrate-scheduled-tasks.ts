import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import type { ScheduledTaskService } from '../services/scheduled-task-service';
import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import type { CreateScheduleTaskInput } from '../db/models/dto/schedule-task.dto';
import { getClaudeScheduledTasksDir, getStoClawHomeDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { getAuthState } from '../utils/auth-store';

/**
 * Step 4 数据迁移：把遗留本地 JSON 定时任务（claude `definitions.json` + openclaw
 * Gateway cron）一次性灌入统一 SQLite `schedule_tasks` 表，generic 调度器随即接管。
 *
 * 幂等：marker 文件 + per-row `getById` 存在检查双闸——进程崩溃可重跑续传。
 *
 * 字段映射原则（两引擎对称）：
 *  - `dingtalkRecipients=null`、prompt **原样保留烘焙块**。执行器见 recipients 空则不
 *    再追加 system-append，钉钉仍由 prompt 内烘焙块触发——行为与旧路径完全一致，
 *    且规避 `stripDingTalkMentionContextForDisplay` 对非标准格式 `return ''` 的空
 *    prompt 数据丢失风险。recipients 列纯度让位于迁移安全；新任务正常填列。
 *  - `next_run_at` 不搬旧 `scheduler-state.json`，建表置 null，末尾 `refreshSchedule`
 *    统一重算（避免时区/陈旧 nextRunAt 坑）。
 *  - openclaw 非 cron-expr 任务（everyMs/at）无法映射到 `cronExpr`，跳过且**不**
 *    cron.remove（留 Gateway 运行）+ 告警，需人工处理。
 */

/** marker / definitions 路径在函数内现算，保证测试 vi.mock 换目录生效、且
 *  路径在模块加载后仍可被 paths 实现动态决定。 */
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

/** openclaw Gateway cron 原始 job（`cron.list` 返回 shape 的最小子集）。 */
interface GatewayCronJob {
  id: string;
  name?: string;
  enabled?: boolean;
  description?: string;
  schedule?: { kind?: string; expr?: string; everyMs?: number; at?: string };
  payload?: { message?: string; text?: string; model?: string };
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

async function migrateOpenclawCronJobs(
  gm: GatewayManager,
  taskRepo: ScheduleTaskRepository,
  actor: string | null,
): Promise<{ migrated: number; skipped: number; nonCron: number }> {
  let jobs: GatewayCronJob[] = [];
  try {
    const result = (await gm.rpc('cron.list', { includeDisabled: true })) as {
      jobs?: GatewayCronJob[];
    };
    jobs = Array.isArray(result?.jobs) ? result.jobs : [];
  } catch (error) {
    logger.warn('[migration] cron.list failed — skipping openclaw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { migrated: 0, skipped: 0, nonCron: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let nonCron = 0;
  for (const job of jobs) {
    const expr = job.schedule?.expr;
    const isCron = job.schedule?.kind === 'cron' || Boolean(expr);
    if (!isCron) {
      nonCron += 1;
      logger.warn('[migration] openclaw job skipped (non-cron schedule, not removed)', {
        id: job.id,
        name: job.name,
        kind: job.schedule?.kind,
      });
      continue;
    }
    if (!expr) {
      nonCron += 1;
      logger.warn('[migration] openclaw job skipped (no cron expr)', { id: job.id });
      continue;
    }

    const existing = await taskRepo.getById(job.id, { includeDeleted: true });
    if (existing) {
      skipped += 1;
    } else {
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
      } catch (error) {
        logger.warn('[migration] openclaw task create failed', {
          id: job.id,
          name: job.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // 创建失败也尝试 remove？否——保留 Gateway cron 以便人工排查。
        continue;
      }
    }

    // 已迁移（或本次创建成功）的 cron 一律从 Gateway 清除，防双调度。
    try {
      await gm.rpc('cron.remove', { id: job.id });
    } catch (error) {
      logger.warn('[migration] cron.remove failed (Gateway cron may linger)', {
        id: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.info(
    `[migration] openclaw: ${migrated} migrated, ${skipped} skipped, ${nonCron} non-cron skipped`,
  );
  return { migrated, skipped, nonCron };
}

/**
 * 一次性迁移入口。在 `setGatewayManager` 之后、`startScheduler` 之前调用。
 * marker 存在即整体跳过；否则迁两引擎 → 写 marker → refreshSchedule 重算 next_run_at。
 */
export async function runScheduledTasksMigration(
  gm: GatewayManager,
  service: ScheduledTaskService,
): Promise<void> {
  const markerFile = join(getStoClawHomeDir(), MARKER_FILENAME);
  if (await fileExists(markerFile)) {
    logger.info('[migration] scheduled-tasks migration already done (marker present)');
    return;
  }

  logger.info('[migration] scheduled-tasks migration starting');
  const taskRepo = new ScheduleTaskRepository();

  const { user } = await getAuthState();
  const actor = user?.code ?? null;

  const claudeResult = await migrateClaudeDefinitions(taskRepo, actor);
  const openclawResult = await migrateOpenclawCronJobs(gm, taskRepo, actor);

  await mkdir(dirname(markerFile), { recursive: true });
  const payload = {
    completedAt: new Date().toISOString(),
    claude: claudeResult,
    openclaw: openclawResult,
  };
  await writeFile(markerFile, JSON.stringify(payload, null, 2), 'utf8');
  logger.info('[migration] marker written', { path: markerFile, payload });

  await service.refreshSchedule();
  logger.info('[migration] refreshSchedule done — next_run_at recomputed');
}
