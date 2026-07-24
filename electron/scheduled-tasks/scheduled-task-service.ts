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
import type { DingTalkMention } from '../../shared/dingtalk-mention';
import {
  buildDingTalkMentionSystemContextForScheduledTask,
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
} from '../../shared/dingtalk-mention-context';
import { ScheduledTaskScheduler } from './scheduled-task-scheduler';
import { validateCronExpr } from '../utils/cron-math';
import {
  EngineScheduledTaskDispatcher,
  loggingEventSink,
  type ScheduledTaskEventSink,
} from './scheduled-task-executor';
import type { GatewayManager } from '../gateway/manager';

/**
 * 引擎无关的定时报表层。在 `ScheduledTaskScheduler`（触发 + claim 单飞）之上，
 * 承担「CRUD + 校验 + 占位会话 + dingtalk 上下文烘焙」——这些都是两引擎共用、
 * 与执行（`runMainChatSend`）正交的职责。
 *
 * 生产路径：app 启动 `setGatewayManager` → 迁移 → `startScheduler`；
 * CRUD / trigger 经 `/api/scheduled-tasks/*`。
 *
 * 复用锚点：
 *  - 校验/默认值/refresh 模式：原 claude-scheduled-task-service（已退役）
 *  - dingtalk 烘焙：`buildDingTalkMentionSystemContextForScheduledTask`（scenario='scheduled-task'，"指定即必发"）
 *  - catalog 占位 upsert：`CatalogSessionRepository.upsert`（`inferSessionCatalogMeta` 推 session_type+task_id；P2-C 不收敛类型）
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

  /** Step 5 注入：未调 `setGatewayManager` 前为 null，执行器 dispatch 直接判失败。 */
  private gatewayManager: GatewayManager | null = null;

  /**
   * Step 5.2 事件下沉：setGatewayManager 前用 `loggingEventSink` 兜底，之后换为
   * gateway 适配 sink——把 run 生命周期事件 emit 到 `GatewayManager` 的 EventEmitter，
   * 经现有 IPC 桥透给 renderer（`scheduled-task:*` 的 renderer 订阅归 Step 5.4）。
   */
  private eventSink: ScheduledTaskEventSink = loggingEventSink;

  async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTask> {
    this.validateTaskInput(input);
    const normalized = this.normalizeDefaults(input);
    const created = await this.taskRepo.create(normalized);
    await this.scheduler.refreshSchedule();
    const reloaded = await this.taskRepo.getById(created.id);
    return reloaded ?? created;
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
    const updated = await this.taskRepo.update(id, input);
    if (!updated) return null;
    await this.scheduler.refreshSchedule();
    return this.taskRepo.getById(id) ?? updated;
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
   * Step 5.1：注入 gatewayManager 并把引擎无关执行器注册到 scheduler。
   * 必须在 app 启动（Step 5.3）gateway ready 后调用——执行器靠它拿底层引擎运行时。
   * 闭包注入避免 service ↔ executor 循环 import；sessionKey 构造与 dingtalk 烘焙
   * 仍是本 service 的单一职责（executor 只消费产物）。
   */
  setGatewayManager(gatewayManager: GatewayManager): void {
    this.gatewayManager = gatewayManager;
    // gateway 适配 sink：事件直发 GatewayManager EventEmitter，renderer 订阅归 Step 5.4。
    this.eventSink = {
      emit: (event, payload) => {
        this.gatewayManager?.emit(event, payload);
      },
    };
    this.scheduler.setDispatcher(
      new EngineScheduledTaskDispatcher({
        runRepo: this.runRepo,
        taskRepo: this.taskRepo,
        getGatewayManager: () => this.gatewayManager,
        ensureDatedSession: (task, date) => this.ensureDatedSessionPlaceholder(task, date),
        buildSystemPromptAppend: (task) => this.buildExecutionSystemPromptAppend(task),
        getEventSink: () => this.eventSink,
      }),
    );
  }

  /**
   * 启动调度器：先丢弃关机期间错过/崩溃中断的任务（推进 `nextRunAt` + 清 stale
   * lease），再启动 tick。`finally` 保证即使清扫抛异常调度器仍会启动。必须在
   * `setGatewayManager` 之后调用——否则 dispatcher 还是 noop，claim 的 run 停在 queued。
   * （镜像 `ClaudeScheduledTaskService.startScheduler` 的「discard→start」原子序。）
   */
  startScheduler(): void {
    void this.scheduler.discardMissedOnStartup().finally(() => this.scheduler.start());
  }

  stopScheduler(): void {
    this.scheduler.stop();
  }

  /**
   * 为定时任务烘焙当日占位会话（catalog 行）。session_key 携引擎前缀，使
   * `inferSessionCatalogMeta` 自动推出 `session_type`（openclaw→`cron`、
   * claude→`claude_task`）与 `task_id`。title 取任务名，保证历史面板可读。
   *
   * P2-C：**不**收敛 `session_type`（保留 `cron`/`claude_task`）。
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
   * 构造定时任务执行期的 dingtalk 收件人系统提示追加段。无 resolved 收件人→null
   * （执行器不追加任何上下文）；有→`buildDingTalkMentionSystemContextForScheduledTask`
   * 烘焙的"指定即必发"块（含 `DINGTALK_RECIPIENTS_MARKER` + 收件人 userId/openConversationId）。
   */
  buildExecutionSystemPromptAppend(task: ScheduleTask): string | null {
    const recipients = task.dingtalkRecipients;
    if (!recipients || !hasResolvedDingTalkMentions(recipients)) {
      return null;
    }
    return buildDingTalkMentionSystemContextForScheduledTask(recipients);
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

/** 执行器（Step 5）从本模块取 dingtalk 烘焙产物，统一引用入口。 */
export { DINGTALK_RECIPIENTS_MARKER, hasResolvedDingTalkMentions };
export type { DingTalkMention };
