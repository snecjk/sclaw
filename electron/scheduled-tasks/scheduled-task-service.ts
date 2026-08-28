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
import { getAuthSessionSnapshot, getAuthState, isAuthSessionCurrent } from '../utils/auth-store';
import { getChatRuntimeSupervisor } from '../services/chat-runtime-supervisor';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import { parseAgentEngineType } from '../../shared/agent-engine';
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
import { claimScheduleTasksOwnership, rewriteScheduleTasksLoginNameOwner } from './schedule-tasks-ownership';
import { runScheduleTasksPushTick } from './schedule-tasks-push';
import {
  getScheduleTasksSyncStatus,
  pullScheduleTasksFromCloud,
  type ScheduleTasksPullResult,
  type ScheduleTasksSyncStatus,
} from './schedule-tasks-pull';

/**
 * Host API 路由会显式写入 actor（可为 null）；Claude NL 工具等直调 service 时常漏传。
 * - `undefined`：从当前登录态补全梧桐工号（trim）
 * - `null`：尊重调用方（迁移显式传 null，不回填登录态）
 * - 非空字符串：trim 后写入；空串视为 null
 */
function normalizeUserCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const code = String(value).trim();
  return code ? code : null;
}

async function resolveScheduleTaskActor(
  actor: string | null | undefined,
): Promise<string | null> {
  if (actor !== undefined) return normalizeUserCode(actor);
  try {
    const { user } = await getAuthState();
    return normalizeUserCode(user?.code);
  } catch (error) {
    logger.warn('[scheduled-task] resolve actor from auth failed:', error);
    return null;
  }
}

/** 当前登录工号；未登录返回 null。 */
async function resolveCurrentUserCode(): Promise<string | null> {
  try {
    const { user } = await getAuthState();
    return normalizeUserCode(user?.code);
  } catch {
    return null;
  }
}

/**
 * 任务是否属于 actor。
 * - 未登录（actor 空）：一律拒绝（含孤儿行，避免未认证可执行 prompt）
 * - 已登录 + created_by 空：视为可操作孤儿（操作路径会认领）
 * - 已登录 + 有归属：必须工号一致（两侧都 trim 比较）
 */
function isTaskOwnedBy(task: ScheduleTask, actor: string | null): boolean {
  const code = normalizeUserCode(actor);
  if (!code) return false;
  const owner = normalizeUserCode(task.createdBy);
  if (!owner) return true;
  return owner === code;
}
/**
 * 引擎无关的定时报表层。在 `ScheduledTaskScheduler`（触发 + claim 单飞）之上，
 * 承担「CRUD + 校验 + 占位会话 + dingtalk 上下文烘焙」——这些都是两引擎共用、
 * 与执行（`runMainChatSend`）正交的职责。
 *
 * 生产路径：app 启动 `setGatewayManager` → 迁移；**已认证后** `onUserAuthenticated` → 认领 + 刷登录名归属 + `startScheduler`；
 * CRUD / trigger 经 `/api/scheduled-tasks/*`。未认证不 startScheduler。
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

  /**
   * 创建定时任务（UI Modal 保存、NL 工具建任务都走这里）。
   *
   * 步骤：
   * 1. 校验必填（name/prompt/agentId/cron）及 permission/retry/failure/timeout
   * 2. 补默认 retryPolicy / failurePolicy
   * 3. NL 回填：读会话最近用户消息，把模型漏传的附件/技能/工作流/收件人并入入参
   *    （UI 已 bake 的 extra.composerSegments 会原样保留）
   * 4. 对齐 Composer 模型（alignScheduledTaskCreateToComposerModel）：
   *    - 合并 attachments + prompt 里的 `[media attached:]` / outbound 裸路径 → extra.composerAttachments
   *    - 剥 prompt 中的 media 行、outbound 绝对路径、`<!-- SClaw-Skill -->`
   *    - 技能/工作流/钉钉收件人只写 extra.composerSegments；三列恒 null
   *    - UI：保留已 bake 的交错 segments；NL：按 prompt 占位重建 segments
   * 5. 插入 `schedule_tasks` 行（此时附件 sourcePath 仍指向
   *    `~/.stoclaw/openclaw/media/outbound/` 等 staging 路径）
   * 6. persistComposerAttachmentsForTask：copyFile 到
   *    `~/.stoclaw/scheduled-tasks/{taskId}/attachments/{id}-{fileName}`，
   *    回写 persistentPath 与 file segment 路径
   * 7. 刷新 cron 调度；再读库返回（含第 6 步回写后的 extra）
   */
  async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTask> {
    // 1. 校验
    this.validateTaskInput(input);
    // 2. 默认策略
    const normalized = this.normalizeDefaults(input);
    // 3. NL 回填：模型常只写 prompt、漏传结构化字段
    const sessionHint = await readLatestOpenClawUserMessageText(input.sessionKey);
    const enriched = mergeComposerHintsIntoCreateInput({
      ...normalized,
      attachments: input.attachments,
      skills: input.skills,
      workflowName: input.workflowName,
      recipients: input.recipients,
      sessionKey: undefined,
    }, [sessionHint]);
    // 4. 对齐 extra.composerSegments / composerAttachments；prompt 变干净
    const aligned = alignScheduledTaskCreateToComposerModel(enriched);
    const actor = await resolveScheduleTaskActor(input.actor);
    // 5. 落库（附件此时仍是 outbound staging 路径）
    const created = await this.taskRepo.create({
      ...aligned,
      actor,
      // extra 真源：三列恒 null
      dingtalkRecipients: null,
      skillCode: null,
      workflowCode: null,
    });
    // 6. 把 outbound 文件拷到任务专属目录并回写 extra
    const withAttachments = await this.persistComposerAttachmentsForTask(created);
    // 7. 让 scheduler 立刻看到新任务
    await this.scheduler.refreshSchedule();
    const reloaded = await this.taskRepo.getById(withAttachments.id);
    return reloaded ?? withAttachments;
  }

  /**
   * 更新定时任务（UI 编辑保存、NL 改任务、部分内部迁移曾误走这里）。
   *
   * 步骤：
   * 1. 只校验本次传入的 cron / permission / retry / failure / timeout
   * 2. extra 浅合并已有 extra（保留 createdVia 等未改字段）
   * 3. 若改了 prompt 或 extra：prepareScheduledTaskAttachmentsForSave
   *    - 合并 extra.composerAttachments + prompt 内 media/outbound 路径
   *    - 剥 prompt 里的 `[media attached:]` 与 outbound 绝对路径
   *    - 同步 file segment 的 sourcePath（仍可能是 outbound）
   * 4. 剥 `<!-- SClaw-Skill -->`（技能真源在 segments）
   * 5. 更新 `schedule_tasks` 行
   * 6. persistComposerAttachmentsForTask：把新附件 copyFile 到
   *    `~/.stoclaw/scheduled-tasks/{taskId}/attachments/`，删掉不再引用的旧文件，
   *    回写 persistentPath
   * 7. 刷新 cron 调度；再读库返回
   *
   * 注意：启动期列→segments 迁移不应走本方法，否则会再次剥路径并可能改/删附件。
   */
  async updateTask(
    id: string,
    input: UpdateScheduleTaskInput,
    options?: { allowCrossOwner?: boolean },
  ): Promise<ScheduleTask | null> {
    // 1. 按字段校验
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
    updatePayload.actor = await resolveScheduleTaskActor(input.actor);
    const existing = await this.taskRepo.getById(id);
    if (!existing) return null;
    if (existing.engineType === 'pi' && input.workflowCode?.trim()) {
      throw new Error('UNSUPPORTED_ENGINE: Pi does not support workflows');
    }
    if (existing.engineType === 'pi' && input.workspacePath !== undefined && !input.workspacePath?.trim()) {
      throw new Error('Pi scheduled tasks require workspacePath');
    }
    if (!options?.allowCrossOwner) {
      if (!isTaskOwnedBy(existing, updatePayload.actor ?? null)) {
        throw new Error('无权修改他人定时任务');
      }
    }
    // 2. extra 与库存浅合并
    if (input.extra !== undefined && input.extra !== null) {
      updatePayload.extra = mergeScheduledTaskExtra(existing.extra, input.extra);
    }
    // 3. 整理附件元数据（尚未 copyFile）
    const prepared = (updatePayload.extra !== undefined || input.prompt !== undefined)
      ? prepareScheduledTaskAttachmentsForSave({
        prompt: input.prompt ?? '',
        extra: updatePayload.extra,
      })
      : null;
    if (prepared && input.prompt !== undefined) {
      // 4. 手动编辑保存：gatewayText 可能仍带 SClaw-Skill marker；任务以 segments 为 skill 真源。
      updatePayload.prompt = stripSkillTranscriptMarkers(prepared.prompt).trim();
    }
    if (prepared && (input.extra !== undefined || prepared.extra)) {
      // prompt 里若带 media 行且未显式传 extra，也写入 composerAttachments
      if (input.extra !== undefined || (input.prompt !== undefined && prepared.extra)) {
        updatePayload.extra = prepared.extra;
      }
    }
    if (existing.engineType === 'pi') {
      updatePayload.permissionProfile = 'workspace-write';
    }
    // 5. 落库
    const updated = await this.taskRepo.update(id, updatePayload);
    if (!updated) return null;
    // 5.1 改名时同步 catalog 里该任务所有行的标题快照（含历史 dated 会话），
    // 避免侧栏在任务定义缺失的回退链上长期显示旧名；失败不影响任务更新。
    const nextName = typeof input.name === 'string' ? input.name.trim() : '';
    if (nextName && nextName !== existing.name?.trim()) {
      try {
        await getCatalogSessionRepository().updateTitlesByTaskId(id, nextName, updatePayload.actor);
      } catch (error) {
        logger.warn('[scheduled-task] sync catalog titles after rename failed:', error);
      }
    }
    // 6. 拷到任务目录 / 清理不再引用的旧附件
    const withAttachments = await this.persistComposerAttachmentsForTask(updated);
    // 7. 刷新调度；若本次关掉任务，取消在途 run
    if (input.enabled === false) {
      await this.stopActiveRunsForTask(id, 'task disabled');
    }
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
    const resolvedActor = await resolveScheduleTaskActor(actor);
    const existing = await this.taskRepo.getById(id);
    if (!existing) return;
    if (!isTaskOwnedBy(existing, resolvedActor)) {
      throw new Error('无权删除他人定时任务');
    }
    await this.taskRepo.softDelete(id, resolvedActor);
    await this.stopActiveRunsForTask(id, 'task deleted');
    await this.scheduler.refreshSchedule();
  }

  async setEnabled(id: string, enabled: boolean, actor?: string | null): Promise<ScheduleTask | null> {
    const resolvedActor = await resolveScheduleTaskActor(actor);
    const existing = await this.taskRepo.getById(id);
    if (!existing) return null;
    if (!isTaskOwnedBy(existing, resolvedActor)) {
      throw new Error('无权修改他人定时任务');
    }
    const updated = await this.taskRepo.setEnabled(id, enabled, resolvedActor);
    if (updated && !enabled) {
      await this.stopActiveRunsForTask(id, 'task disabled');
    }
    await this.scheduler.refreshSchedule();
    return updated ? this.taskRepo.getById(id) ?? updated : null;
  }

  /**
   * 关闭 / 删除后：尽力 abort 正在跑的引擎，并把 queued/running 租约标 cancelled。
   * abort 失败不阻断 DB 取消——dispatch 重读库时仍会拒发。
   */
  private async stopActiveRunsForTask(taskId: string, reason: string): Promise<void> {
    const active = await this.runRepo.getActiveRun(taskId);
    if (active?.status === 'running' && active.sessionKey && this.gatewayManager) {
      try {
        const task = await this.taskRepo.getById(taskId, { includeDeleted: true });
        if (task) {
          const gatewayManager = this.gatewayManager;
          const supervisor = getChatRuntimeSupervisor(gatewayManager);
          await supervisor.aborting(active.sessionKey);
          const { getAdapter } = await import('../engines/manager');
          const result = await getAdapter(task.engineType).abortRun(
            { gatewayManager },
            { sessionKey: active.sessionKey },
          );
          if (!result.success) {
            await supervisor.abortFailed(active.sessionKey, result.error || 'scheduled-task abort failed');
          } else {
            await supervisor.aborted(active.sessionKey, null);
          }
        }
      } catch (error) {
        logger.warn('[scheduled-task] abort running engine failed', {
          taskId,
          runId: active.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const cancelled = await this.runRepo.cancelActiveRunsForTask(taskId, { error: reason });
    if (cancelled > 0) {
      logger.info('[scheduled-task] cancelled active runs', { taskId, cancelled, reason });
    }
  }

  async listTasks(): Promise<ScheduleTask[]> {
    const code = await resolveCurrentUserCode();
    if (!code) return [];
    return this.taskRepo.list({ createdBy: code, limit: 10_000 });
  }

  async getTask(id: string): Promise<ScheduleTask | null> {
    const task = await this.taskRepo.getById(id);
    if (!task) return null;
    const code = await resolveCurrentUserCode();
    if (!isTaskOwnedBy(task, code)) return null;
    return task;
  }

  async getLatestRun(taskId: string): Promise<ScheduleTaskRun | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;
    return this.runRepo.getLatestRun(taskId);
  }

  async triggerTask(id: string): Promise<ScheduleTaskRun> {
    const code = await resolveCurrentUserCode();
    const task = await this.taskRepo.getById(id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }
    if (!isTaskOwnedBy(task, code)) {
      throw new Error('无权触发他人定时任务');
    }
    if (code && (task.createdBy == null || String(task.createdBy).trim() === '')) {
      await this.taskRepo.claimOrphanById(id, code);
    }
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
   * 已认证后同一入口（SSO 登录成功 或 冷启动已登录）：
   * 认领 NULL → 刷登录名归属 → startScheduler。不立刻 push。
   */
  onUserAuthenticated(userCode: string): void {
    const code = userCode.trim();
    if (!code) return;
    void (async () => {
      // 入口取登录世代快照：异步段内若发生登出/切号/强制重登（世代翻转），
      // 后续认领、刷库、startScheduler 全部放弃，避免旧 code 继续生效。
      const sessionSnapshot = await getAuthSessionSnapshot();
      const sessionCurrent = () => isAuthSessionCurrent(sessionSnapshot).catch(() => false);
      if (!(await sessionCurrent())) return;
      try {
        await claimScheduleTasksOwnership(code, this.taskRepo);
      } catch (error) {
        logger.warn('[scheduled-task] ownership claim failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!(await sessionCurrent())) return;
      await this.rewriteLoginNameOwnerSafely(code);
      if (!(await sessionCurrent())) return;
      this.startScheduler(code);
    })();
  }

  /** 刷 `created_by=当前登录名` 为工号。失败只 warn，不挡调度 / pull。 */
  private async rewriteLoginNameOwnerSafely(code: string): Promise<void> {
    try {
      const { user } = await getAuthState();
      // 入口 code 与读取时的登录态之间可能已切号：身份对不上则放弃本次刷库，
      // 避免把「新登录名的行」刷成旧 code（B 的任务被写成 A 的工号）。
      if (user?.code?.trim() !== code) return;
      const userName = user?.userName?.trim() ?? '';
      await rewriteScheduleTasksLoginNameOwner(code, userName, this.taskRepo);
    } catch (error) {
      logger.warn('[scheduled-task] login-name owner rewrite failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 启动调度器：先丢弃关机期间错过/崩溃中断的任务（推进 `nextRunAt` + 清 stale
   * lease），再启动 tick。`finally` 保证即使清扫抛异常调度器仍会启动。必须在
   * `setGatewayManager` 之后调用——否则 dispatcher 还是 noop，claim 的 run 停在 queued。
   * 仅已认证入口调用；initialize() 不得 start。
   */
  startScheduler(userCode?: string): void {
    const code = userCode?.trim() || null;
    if (code) {
      this.scheduler.setOwnerUserCode(code);
    }
    this.scheduler.setPushTick(() => {
      void (async () => {
        try {
          const { user } = await getAuthState();
          const pushCode = user?.code?.trim();
          if (!pushCode) return;
          await runScheduleTasksPushTick(pushCode, { taskRepo: this.taskRepo });
        } catch (error) {
          logger.warn('[scheduled-task] push tick failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
    const supervisor = this.gatewayManager ? getChatRuntimeSupervisor(this.gatewayManager) : null;
    void (async () => {
      if (!code) {
        const resolved = await resolveCurrentUserCode();
        if (resolved) this.scheduler.setOwnerUserCode(resolved);
      }
      if (supervisor) {
        await supervisor.initialize();
        await this.runtimeDispatcher?.recoverActiveRuns(supervisor);
      }
      await this.scheduler.discardMissedOnStartup();
      await this.scheduler.refreshSchedule();
    })().catch((error) => {
      logger.warn('[scheduled-task] startup recovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => this.scheduler.start());
  }

  stopScheduler(): void {
    this.scheduler.setPushTick(null);
    this.scheduler.setOwnerUserCode(null);
    this.scheduler.stop();
  }

  async getCloudSyncStatus(): Promise<ScheduleTasksSyncStatus> {
    const { user } = await getAuthState();
    const code = user?.code?.trim();
    if (!code) {
      throw Object.assign(new Error('未登录'), { statusCode: 401 });
    }
    return getScheduleTasksSyncStatus(code, this.taskRepo);
  }

  async pullFromCloud(): Promise<ScheduleTasksPullResult> {
    const { user } = await getAuthState();
    const code = user?.code?.trim();
    if (!code) {
      throw Object.assign(new Error('未登录'), { statusCode: 401 });
    }
    const result = await pullScheduleTasksFromCloud(code, this.taskRepo);
    await this.rewriteLoginNameOwnerSafely(code);
    await this.scheduler.refreshSchedule();
    return result;
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
    const tasks = await this.taskRepo.list({ limit: 10_000 });
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
        await this.updateTask(
          task.id,
          {
            dingtalkRecipients: plan.dingtalkRecipients,
            ...(plan.stripped ? { prompt: plan.prompt } : {}),
            actor: null,
          },
          { allowCrossOwner: true },
        );
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
    const tasks = await this.taskRepo.list({ limit: 10_000 });
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
        await this.updateTask(
          task.id,
          {
            prompt: plan.prompt,
            dingtalkRecipients: null,
            skillCode: null,
            workflowCode: null,
            extra: plan.extra,
            actor: null,
          },
          { allowCrossOwner: true },
        );
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
    const tasks = await this.taskRepo.list({ limit: 10_000 });
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
        await this.updateTask(
          task.id,
          {
            prompt: plan.prompt,
            dingtalkRecipients: null,
            extra: plan.extra,
            actor: null,
          },
          { allowCrossOwner: true },
        );
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
    if (!parseAgentEngineType(input.engineType)) {
      throw new Error(`UNSUPPORTED_ENGINE: ${String(input.engineType)}`);
    }
    this.assertRequired(input.name, 'name');
    this.assertRequired(input.prompt, 'prompt');
    this.assertRequired(input.agentId, 'agentId');
    this.assertRequired(input.cronExpr, 'cronExpr');
    validateCronExpr(input.cronExpr);
    if (input.engineType === 'pi' && input.workflowCode?.trim()) {
      throw new Error('UNSUPPORTED_ENGINE: Pi does not support workflows');
    }
    if (input.engineType === 'pi' && !input.workspacePath?.trim()) {
      throw new Error('Pi scheduled tasks require workspacePath');
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
    if (input.timeoutSec != null && input.timeoutSec < 1) {
      throw new Error('timeoutSec must be a positive number of seconds');
    }
  }

  private normalizeDefaults(input: CreateScheduleTaskInput): CreateScheduleTaskInput {
    return {
      ...input,
      permissionProfile: input.engineType === 'pi' ? 'workspace-write' : input.permissionProfile,
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
    if (task.engineType === 'claude') return `claude-task:${task.id}:${ymd}`;
    if (task.engineType === 'pi') return `pi-task:${task.id}:${ymd}`;
    return `agent:${task.agentId}:cron:${task.id}:${ymd}`;
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
 * 惰性单例。app 启动经 `setGatewayManager` 接入；已认证后 `onUserAuthenticated` → startScheduler。
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
