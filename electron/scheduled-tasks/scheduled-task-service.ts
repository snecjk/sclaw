import { ScheduleTaskRepository } from '../db/repositories/schedule-task-repository';
import { ScheduleTaskRunRepository } from '../db/repositories/schedule-task-run-repository';
import {
  getCatalogSessionRepository,
  type CatalogSessionRepository,
} from '../db/repositories/catalog-session-repository';
import { DEFAULT_WORKSPACE_ID } from '../db';
import type { CatalogSession } from '../db/models/domain/session-catalog';
import type {
  ScheduleTask,
  ScheduleTaskFailurePolicy,
  ScheduleTaskPermissionProfile,
  ScheduleTaskRetryPolicy,
  ScheduleTaskRun,
} from '../db/models/domain/schedule-task';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../db/models/dto/schedule-task.dto';
import {
  buildDingTalkMentionSystemContextForScheduledTask,
} from '../../shared/dingtalk-prompts/dingtalk-mention-context';
import {
  buildScheduledTaskDingTalkPromptAppend,
  SCHEDULED_TASK_DINGTALK_RULES,
} from '../../shared/dingtalk-prompts';
import { stripSkillTranscriptMarkers } from '../../shared/skill-transcript-marker';
import {
  planComposerColumnsToSegmentsMigration,
  planComposerSegmentsRecipientsMigration,
  planDingTalkRecipientsLift,
  resolveScheduledTaskDingTalkRecipients,
} from '../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
import { ScheduledTaskScheduler } from './scheduled-task-scheduler';
import { validateCronExpr } from './cron-math';
import {
  EngineScheduledTaskDispatcher,
  loggingEventSink,
  type ScheduledTaskEventSink,
} from './scheduled-task-executor';
import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { getChatRuntimeSupervisor } from '../services/chat-runtime-supervisor';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import {
  persistScheduledTaskAttachments,
  prepareScheduledTaskAttachmentsForSave,
  rewriteComposerSegmentFilePaths,
  type TaskComposerAttachmentRecord,
} from './scheduled-task-attachments';
import { mergeScheduledTaskExtra } from '../../shared/scheduled-task-extra';
import { alignScheduledTaskCreateToComposerModel } from './scheduled-task-nl-create';
import {
  mergeComposerHintsIntoCreateInput,
  readLatestOpenClawUserMessageText,
} from './scheduled-task-nl-hints';

/**
 * 引擎无关的定时报表层。在 `ScheduledTaskScheduler`（触发 + claim 单飞）之上，
 * 承担「CRUD + 校验 + 占位会话 + dingtalk 上下文烘焙」——这些都是两引擎共用、
 * 与执行（`runMainChatSend`）正交的职责。
 *
 * 生产路径：app 启动 `setGatewayManager` → 迁移 → `startScheduler`；
 * CRUD / trigger 经 `/api/scheduled-tasks/*`。
 */

const PERMISSION_PROFILES: readonly ScheduleTaskPermissionProfile[] = [
  'readonly-safe',
  'workspace-write',
  'dangerous-bypass',
];

let scheduledTaskService: ScheduledTaskService | null = null;

export class ScheduledTaskService {
  constructor(
    private readonly scheduler: ScheduledTaskScheduler = new ScheduledTaskScheduler(),
    private readonly taskRepo: ScheduleTaskRepository = new ScheduleTaskRepository(),
    private readonly runRepo: ScheduleTaskRunRepository = new ScheduleTaskRunRepository(),
    private readonly catalogRepo: CatalogSessionRepository = getCatalogSessionRepository(),
  ) {}

  /** 未调 `setGatewayManager` 前为 null，执行器 dispatch 直接判失败。 */
  private gatewayManager: GatewayManager | null = null;

  /**
   * run 生命周期事件下沉：setGatewayManager 前用 `loggingEventSink` 兜底，之后换为
   * gateway 适配 sink（emit 到 `GatewayManager`，经 IPC 透给 renderer）。
   */
  private eventSink: ScheduledTaskEventSink = loggingEventSink;
  private runtimeDispatcher: EngineScheduledTaskDispatcher | null = null;
  private runtimeEventListener: ((event: CanonicalChatEvent) => void) | null = null;

  async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTask> {
    this.validateTaskInput(input);
    const normalized = this.normalizeDefaults(input);
    // 模型常只写 prompt、漏传结构化字段：从 prompt + 会话最近用户消息回填
    const sessionHint = await readLatestOpenClawUserMessageText(input.sessionKey);
    const enriched = mergeComposerHintsIntoCreateInput({
      ...normalized,
      attachments: input.attachments,
      skills: input.skills,
      workflowName: input.workflowName,
      recipients: input.recipients,
      sessionKey: undefined,
    }, [sessionHint]);
    const aligned = alignScheduledTaskCreateToComposerModel(enriched);
    const created = await this.taskRepo.create({
      ...aligned,
      // extra 真源：三列恒 null
      dingtalkRecipients: null,
      skillCode: null,
      workflowCode: null,
    });
    const withAttachments = await this.persistComposerAttachmentsForTask(created);
    await this.scheduler.refreshSchedule();
    const reloaded = await this.taskRepo.getById(withAttachments.id);
    return reloaded ?? withAttachments;
  }

  async updateTask(id: string, input: UpdateScheduleTaskInput): Promise<ScheduleTask | null> {
    if (input.cronExpr !== undefined) {
      validateCronExpr(input.cronExpr);
    }
    if (input.permissionProfile != null) {
      this.assertPermissionProfile(input.permissionProfile);
    }
    if (input.retryPolicy != null) {
      this.assertRetryPolicy(input.retryPolicy);
    }
    if (input.failurePolicy != null) {
      this.assertFailurePolicy(input.failurePolicy);
    }
    if (input.timeoutSec !== undefined && input.timeoutSec !== null && input.timeoutSec < 1) {
      throw new Error('timeoutSec must be a positive number of seconds');
    }
    const updatePayload: UpdateScheduleTaskInput = { ...input };
    if (input.extra !== undefined && input.extra !== null) {
      const existing = await this.taskRepo.getById(id);
      updatePayload.extra = mergeScheduledTaskExtra(existing?.extra, input.extra);
    }
    const prepared = (updatePayload.extra !== undefined || input.prompt !== undefined)
      ? prepareScheduledTaskAttachmentsForSave({
        prompt: input.prompt ?? '',
        extra: updatePayload.extra,
      })
      : null;
    if (prepared && input.prompt !== undefined) {
      // 手动编辑保存：gatewayText 可能仍带 SClaw-Skill marker；任务以 segments 为 skill 真源。
      updatePayload.prompt = stripSkillTranscriptMarkers(prepared.prompt).trim();
    }
    if (prepared && (input.extra !== undefined || prepared.extra)) {
      // prompt 里若带 media 行且未显式传 extra，也写入 composerAttachments
      if (input.extra !== undefined || (input.prompt !== undefined && prepared.extra)) {
        updatePayload.extra = prepared.extra;
      }
    }
    const updated = await this.taskRepo.update(id, updatePayload);
    if (!updated) return null;
    const withAttachments = await this.persistComposerAttachmentsForTask(updated);
    await this.scheduler.refreshSchedule();
    return this.taskRepo.getById(id) ?? withAttachments;
  }

  /**
   * 把 extra.composerAttachments 的 staging 文件复制到任务专属目录，
   * 回写 persistentPath 与 file segment 路径。
   */
  private async persistComposerAttachmentsForTask(task: ScheduleTask): Promise<ScheduleTask> {
    const extra = task.extra && typeof task.extra === 'object' ? { ...task.extra } : null;
    if (!extra) return task;
    const rawAttachments = extra.composerAttachments;
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
      // 编辑保存清空附件时仍清理旧文件
      if (Array.isArray(rawAttachments)) {
        await persistScheduledTaskAttachments(task.id, []);
      }
      return task;
    }

    const persisted = await persistScheduledTaskAttachments(
      task.id,
      rawAttachments as TaskComposerAttachmentRecord[],
    );
    extra.composerAttachments = persisted;
    if (Array.isArray(extra.composerSegments)) {
      extra.composerSegments = rewriteComposerSegmentFilePaths(
        extra.composerSegments,
        persisted,
      ) as unknown[];
    }

    const rewritten = await this.taskRepo.update(task.id, { extra });
    return rewritten ?? { ...task, extra };
  }

  async deleteTask(id: string, actor?: string | null): Promise<void> {
    await this.taskRepo.softDelete(id, actor);
    await this.scheduler.refreshSchedule();
  }

  async setEnabled(id: string, enabled: boolean, actor?: string | null): Promise<ScheduleTask | null> {
    const updated = await this.taskRepo.setEnabled(id, enabled, actor);
    await this.scheduler.refreshSchedule();
    return updated ? this.taskRepo.getById(id) ?? updated : null;
  }

  async listTasks(): Promise<ScheduleTask[]> {
    return this.taskRepo.list({});
  }

  async getTask(id: string): Promise<ScheduleTask | null> {
    return this.taskRepo.getById(id);
  }

  async getLatestRun(taskId: string): Promise<ScheduleTaskRun | null> {
    return this.runRepo.getLatestRun(taskId);
  }

  async triggerTask(id: string): Promise<ScheduleTaskRun> {
    return this.scheduler.triggerTaskNow(id);
  }

  async refreshSchedule(): Promise<void> {
    await this.scheduler.refreshSchedule();
  }

  /**
   * 注入 gatewayManager 并把引擎无关执行器注册到 scheduler。
   * 必须在 app 启动 gateway ready 后调用。闭包注入避免 service ↔ executor 循环
   * import；sessionKey 构造与 dingtalk 烘焙仍是本 service 的单一职责。
   */
  setGatewayManager(gatewayManager: GatewayManager): void {
    if (this.gatewayManager && this.runtimeEventListener) {
      getChatRuntimeSupervisor(this.gatewayManager).off('event', this.runtimeEventListener);
    }
    this.gatewayManager = gatewayManager;
    this.eventSink = {
      emit: (event, payload) => {
        this.gatewayManager?.emit(event, payload);
      },
    };
    this.runtimeDispatcher = new EngineScheduledTaskDispatcher({
        runRepo: this.runRepo,
        taskRepo: this.taskRepo,
        getGatewayManager: () => this.gatewayManager,
        ensureDatedSession: (task, date) => this.ensureDatedSessionPlaceholder(task, date),
        buildSystemPromptAppend: (task) => this.buildExecutionSystemPromptAppend(task),
        getEventSink: () => this.eventSink,
      });
    this.scheduler.setDispatcher(this.runtimeDispatcher);
    const supervisor = getChatRuntimeSupervisor(gatewayManager);
    this.scheduler.setCanReapRun(async (run) => {
      const snapshot = await supervisor.getByOwner('scheduled_task', run.runId);
      return snapshot == null;
    });
    this.runtimeEventListener = (event) => {
      void this.runtimeDispatcher?.handleCanonicalEvent(event).catch((error) => {
        logger.warn('[scheduled-task] canonical terminal handling failed', {
          eventId: event.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    supervisor.on('event', this.runtimeEventListener);
  }

  /**
   * 启动调度器：先丢弃关机期间错过/崩溃中断的任务（推进 `nextRunAt` + 清 stale
   * lease），再启动 tick。`finally` 保证即使清扫抛异常调度器仍会启动。必须在
   * `setGatewayManager` 之后调用——否则 dispatcher 还是 noop，claim 的 run 停在 queued。
   */
  startScheduler(): void {
    const supervisor = this.gatewayManager ? getChatRuntimeSupervisor(this.gatewayManager) : null;
    void (async () => {
      if (supervisor) {
        await supervisor.initialize();
        await this.runtimeDispatcher?.recoverActiveRuns(supervisor);
      }
      await this.scheduler.discardMissedOnStartup();
    })().catch((error) => {
      logger.warn('[scheduled-task] startup recovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => this.scheduler.start());
  }

  stopScheduler(): void {
    this.scheduler.stop();
  }

  /**
   * 为定时任务烘焙当日占位会话（catalog 行）。session_key 携引擎前缀，使
   * `inferSessionCatalogMeta` 自动推出 `session_type`（openclaw→`cron`、
   * claude→`claude_task`）与 `task_id`。title 取任务名，保证历史面板可读。
   */
  async ensureDatedSessionPlaceholder(
    task: ScheduleTask,
    date: Date = new Date(),
  ): Promise<CatalogSession> {
    const sessionKey = this.buildDatedSessionKey(task, date);
    return this.catalogRepo.upsert({
      workspaceId: DEFAULT_WORKSPACE_ID,
      sessionKey,
      title: task.name,
      taskId: task.id,
    });
  }

  /**
   * 构造定时任务执行期的钉钉相关 systemPromptAppend。
   * - 列优先：收件人块 + 模块 C（禁询问 / 指定即必发；格式细则已在收件人块内，不重复模块 A）
   * - 列空则解析 prompt 内历史 Recipients 块 → 同上
   * - 仍无 resolved 收件人，但 prompt 含块或 `dws chat message send` → 模块 C/A 条件拼接（不含 CORE）
   * - 否则 null（执行器不追加；CORE 由引擎 hook 注入）
   */
  buildExecutionSystemPromptAppend(task: ScheduleTask): string | null {
    const recipients = resolveScheduledTaskDingTalkRecipients(task);
    if (recipients) {
      return [
        buildDingTalkMentionSystemContextForScheduledTask(recipients),
        SCHEDULED_TASK_DINGTALK_RULES,
      ].join('\n\n');
    }
    return buildScheduledTaskDingTalkPromptAppend(task.prompt);
  }

  /**
   * 可选一次性回填：列空且 prompt 含可解析收件人块 → 写入 `dingtalk_recipients_json`。
   * 默认 dryRun；`stripPromptBlock` 为 true 时同步剥掉 prompt 内规则大块。
   * 不改 package.json；由调用方（开发者 / 运维）显式触发。
   * @deprecated 优先用 migrateDingTalkRecipientsToComposerSegments
   */
  async liftDingTalkRecipientsFromPrompts(options?: {
    dryRun?: boolean;
    stripPromptBlock?: boolean;
  }): Promise<{
    scanned: number;
    lifted: number;
    skipped: number;
    dryRun: boolean;
    details: Array<{ taskId: string; name: string; action: string; reason: string; stripped?: boolean }>;
  }> {
    const dryRun = options?.dryRun !== false;
    const stripPromptBlock = options?.stripPromptBlock === true;
    const tasks = await this.listTasks();
    const details: Array<{
      taskId: string;
      name: string;
      action: string;
      reason: string;
      stripped?: boolean;
    }> = [];
    let lifted = 0;
    let skipped = 0;

    for (const task of tasks) {
      const plan = planDingTalkRecipientsLift(task, { stripPromptBlock });
      if (plan.action === 'skip') {
        skipped += 1;
        details.push({
          taskId: task.id,
          name: task.name,
          action: 'skip',
          reason: plan.reason,
        });
        continue;
      }

      if (!dryRun) {
        await this.updateTask(task.id, {
          dingtalkRecipients: plan.dingtalkRecipients,
          ...(plan.stripped ? { prompt: plan.prompt } : {}),
        });
      }
      lifted += 1;
      details.push({
        taskId: task.id,
        name: task.name,
        action: dryRun ? 'would_lift' : 'lift',
        reason: plan.reason,
        stripped: plan.stripped,
      });
    }

    logger.info('[scheduled-task] dingtalk recipients lift', {
      dryRun,
      scanned: tasks.length,
      lifted,
      skipped,
      stripPromptBlock,
    });

    return {
      scanned: tasks.length,
      lifted,
      skipped,
      dryRun,
      details,
    };
  }

  /**
   * 收件人 / skill_code / workflow_code 列 → `extra.composerSegments`，三列清空。
   * 默认 dryRun；生产启动由 migrate 脚本带 marker 调用 dryRun:false。
   */
  async migrateComposerColumnsToSegments(options?: {
    dryRun?: boolean;
  }): Promise<{
    scanned: number;
    migrated: number;
    skipped: number;
    dryRun: boolean;
    details: Array<{
      taskId: string;
      name: string;
      action: string;
      reason: string;
      stripped?: boolean;
    }>;
  }> {
    const dryRun = options?.dryRun !== false;
    const tasks = await this.listTasks();
    const details: Array<{
      taskId: string;
      name: string;
      action: string;
      reason: string;
      stripped?: boolean;
    }> = [];
    let migrated = 0;
    let skipped = 0;

    for (const task of tasks) {
      const plan = planComposerColumnsToSegmentsMigration(task);
      if (plan.action === 'skip') {
        skipped += 1;
        details.push({
          taskId: task.id,
          name: task.name,
          action: 'skip',
          reason: plan.reason,
        });
        continue;
      }

      if (!dryRun) {
        await this.updateTask(task.id, {
          prompt: plan.prompt,
          dingtalkRecipients: null,
          skillCode: null,
          workflowCode: null,
          extra: plan.extra,
        });
      }
      migrated += 1;
      details.push({
        taskId: task.id,
        name: task.name,
        action: dryRun ? 'would_migrate' : 'migrate',
        reason: plan.reason,
        stripped: plan.stripped,
      });
    }

    logger.info('[scheduled-task] columns → composerSegments', {
      dryRun,
      scanned: tasks.length,
      migrated,
      skipped,
    });

    return {
      scanned: tasks.length,
      migrated,
      skipped,
      dryRun,
      details,
    };
  }

  /**
   * 收件人列 / prompt 块 → `extra.composerSegments` mention segment。
   * @deprecated 使用 migrateComposerColumnsToSegments（含技能/工作流列）。
   */
  async migrateDingTalkRecipientsToComposerSegments(options?: {
    dryRun?: boolean;
  }): Promise<{
    scanned: number;
    migrated: number;
    skipped: number;
    dryRun: boolean;
    details: Array<{
      taskId: string;
      name: string;
      action: string;
      reason: string;
      stripped?: boolean;
    }>;
  }> {
    const dryRun = options?.dryRun !== false;
    const tasks = await this.listTasks();
    const details: Array<{
      taskId: string;
      name: string;
      action: string;
      reason: string;
      stripped?: boolean;
    }> = [];
    let migrated = 0;
    let skipped = 0;

    for (const task of tasks) {
      const plan = planComposerSegmentsRecipientsMigration(task);
      if (plan.action === 'skip') {
        skipped += 1;
        details.push({
          taskId: task.id,
          name: task.name,
          action: 'skip',
          reason: plan.reason,
        });
        continue;
      }

      if (!dryRun) {
        await this.updateTask(task.id, {
          prompt: plan.prompt,
          dingtalkRecipients: null,
          extra: plan.extra,
        });
      }
      migrated += 1;
      details.push({
        taskId: task.id,
        name: task.name,
        action: dryRun ? 'would_migrate' : 'migrate',
        reason: plan.reason,
        stripped: plan.stripped,
      });
    }

    logger.info('[scheduled-task] dingtalk recipients → composerSegments', {
      dryRun,
      scanned: tasks.length,
      migrated,
      skipped,
    });

    return {
      scanned: tasks.length,
      migrated,
      skipped,
      dryRun,
      details,
    };
  }

  // ---- 内部：校验 / 默认值 / session key ----

  private validateTaskInput(input: CreateScheduleTaskInput): void {
    this.assertRequired(input.name, 'name');
    this.assertRequired(input.prompt, 'prompt');
    this.assertRequired(input.agentId, 'agentId');
    this.assertRequired(input.cronExpr, 'cronExpr');
    validateCronExpr(input.cronExpr);
    if (input.permissionProfile != null) {
      this.assertPermissionProfile(input.permissionProfile);
    }
    if (input.retryPolicy != null) {
      this.assertRetryPolicy(input.retryPolicy);
    }
    if (input.failurePolicy != null) {
      this.assertFailurePolicy(input.failurePolicy);
    }
    if (input.timeoutSec != null && input.timeoutSec < 1) {
      throw new Error('timeoutSec must be a positive number of seconds');
    }
  }

  private normalizeDefaults(input: CreateScheduleTaskInput): CreateScheduleTaskInput {
    return {
      ...input,
      retryPolicy: input.retryPolicy ?? { maxAttempts: 1, backoffSec: 30 },
      failurePolicy: input.failurePolicy ?? { pauseAfterConsecutiveFailures: 3 },
    };
  }

  private assertRequired(value: unknown, field: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Scheduled task ${field} is required`);
    }
  }

  private assertPermissionProfile(value: ScheduleTaskPermissionProfile): void {
    if (!PERMISSION_PROFILES.includes(value)) {
      throw new Error(`Invalid permissionProfile: ${value}`);
    }
  }

  private assertRetryPolicy(value: ScheduleTaskRetryPolicy): void {
    if (!Number.isFinite(value.maxAttempts) || value.maxAttempts < 1) {
      throw new Error('retryPolicy.maxAttempts must be >= 1');
    }
    if (!Number.isFinite(value.backoffSec) || value.backoffSec < 0) {
      throw new Error('retryPolicy.backoffSec must be >= 0');
    }
  }

  private assertFailurePolicy(value: ScheduleTaskFailurePolicy): void {
    if (!Number.isFinite(value.pauseAfterConsecutiveFailures) || value.pauseAfterConsecutiveFailures < 1) {
      throw new Error('failurePolicy.pauseAfterConsecutiveFailures must be >= 1');
    }
  }

  private buildDatedSessionKey(task: ScheduleTask, date: Date): string {
    const ymd = this.formatLocalYmd(date);
    return task.engineType === 'claude'
      ? `claude-task:${task.id}:${ymd}`
      : `agent:${task.agentId}:cron:${task.id}:${ymd}`;
  }

  /** 本地时区 YYYY-MM-DD（内联，避免额外 util 依赖）。 */
  private formatLocalYmd(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * 惰性单例。app 启动经 `setGatewayManager` + `startScheduler` 接入生产路径。
 */
export function getScheduledTaskService(): ScheduledTaskService {
  if (!scheduledTaskService) {
    scheduledTaskService = new ScheduledTaskService();
  }
  return scheduledTaskService;
}

/** dingtalk 收件人相关共享类型/常量的统一引用入口。 */
export {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
} from '../../shared/dingtalk-send/dingtalk-mention';
export type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
