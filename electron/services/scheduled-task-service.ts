/**
 * Scheduled Task Service
 *
 * Proxies scheduled task endpoints from the new STO Scheduled Tasks API.
 * Uses stoToken for authentication against baseinfo-aimemory*.sto.cn.
 */

import { getStoToken, getAuthState } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { getCurrentEnvConfig } from '../../shared/env-config';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types (mirroring the API response structure, camelCased for frontend)
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  id: number;
  ownerUserId: string;
  name: string;
  taskType: string;
  description: string;
  cronExpr: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  notifyMode: string | null;
  siteCode: string | null;
  siteName: string | null;
  dingdingId: string | null;
  dingdingGroupId: string | null;
  dingdingGroupName: string | null;
  ossObjectKey: string | null;
  dialogSessionKey: string | null;
  openclawGatewayUrl: string | null;
  workflowCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskCreateInput {
  name: string;
  cronExpr: string;
  description?: string;
  taskType?: string;
  notifyMode?: string;
  siteCode?: string;
  siteName?: string;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  dialogSessionKey?: string;
  openclawGatewayUrl?: string;
  workflowCode?: string;
}

export interface ScheduledTaskUpdateInput {
  taskId: number;
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
  enabled?: boolean;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  workflowCode?: string;
}

export interface ScheduledTaskRun {
  id: number;
  taskId: number;
  status: string;
  executionResult?: string;
  logText?: string;
  notifyDingtalkOk?: boolean;
}

export interface ScheduledTaskTriggerResponse {
  taskId: number;
  runId: number;
  outcome: string;
  run?: ScheduledTaskRun;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCamelCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function mapTask(data: Record<string, unknown>): ScheduledTask {
  const t = toCamelCase(data);
  return {
    id: Number(t.id) || 0,
    ownerUserId: String(t.ownerUserId || ''),
    name: String(t.name || ''),
    taskType: String(t.taskType || 'MONITOR_TASK'),
    description: String(t.description || ''),
    cronExpr: String(t.cronExpr || ''),
    enabled: Boolean(t.enabled),
    nextRunAt: t.nextRunAt != null ? String(t.nextRunAt) : null,
    lastRunAt: t.lastRunAt != null ? String(t.lastRunAt) : null,
    lastRunStatus: t.lastRunStatus != null ? String(t.lastRunStatus) : null,
    notifyMode: t.notifyMode != null ? String(t.notifyMode) : null,
    siteCode: t.siteCode != null ? String(t.siteCode) : null,
    siteName: t.siteName != null ? String(t.siteName) : null,
    dingdingId: t.dingdingId != null ? String(t.dingdingId) : null,
    dingdingGroupId: t.dingdingGroupId != null ? String(t.dingdingGroupId) : null,
    dingdingGroupName: t.dingdingGroupName != null ? String(t.dingdingGroupName) : null,
    ossObjectKey: t.ossObjectKey != null ? String(t.ossObjectKey) : null,
    dialogSessionKey: t.dialogSessionKey != null ? String(t.dialogSessionKey) : null,
    openclawGatewayUrl: t.openclawGatewayUrl != null ? String(t.openclawGatewayUrl) : null,
    workflowCode: t.workFlowCode != null ? String(t.workFlowCode) : null,
    createdAt: String(t.createdAt || ''),
    updatedAt: String(t.updatedAt || ''),
  };
}

// ---------------------------------------------------------------------------
// Robot Code (fixed per environment and user type)
// ---------------------------------------------------------------------------

const ROBOT_CODE_SITE = 'J251030001';
const ROBOT_CODE_PROVINCE_PROD = 'J241112001';
const ROBOT_CODE_PROVINCE_NON_PROD = 'J241104001';

async function getRobotCode(): Promise<string | undefined> {
  const authState = await getAuthState();
  const categoryCode = authState.user?.categoryCode ?? '';
  const isSite = categoryCode === '独立网点';
  const envConfig = getCurrentEnvConfig();
  const robotCode = isSite
    ? ROBOT_CODE_SITE
    : envConfig.isProduction
      ? ROBOT_CODE_PROVINCE_PROD
      : ROBOT_CODE_PROVINCE_NON_PROD;
  logger.info(`[ScheduledTaskService] getRobotCode categoryCode=${categoryCode} isSite=${isSite} env=${envConfig.displayLabel} robotCode=${robotCode}`);
  return robotCode;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduledTaskService {
  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');
    return {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
    };
  }

  private async resolveBaseUrl(): Promise<string> {
    const stoBaseUrl = await resolveStoBaseUrl();
    return `${stoBaseUrl}/agent/v1/scheduled-tasks`;
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------
  async listTasks(): Promise<ScheduledTask[]> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/list`;
    logger.info(`[ScheduledTaskService] >>> listTasks url=${url}`);
    logger.info(`[ScheduledTaskService] >>> listTasks headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);
    const curlCmd = `curl -X GET "${url}" -H "stotoken: ${headers.stotoken}" -H "Authorization: ${headers.Authorization}" -H "Content-Type: ${headers['Content-Type']}"`;
    logger.info(`[ScheduledTaskService] >>> listTasks curl=${curlCmd}`);

    const res = await fetch(url, { method: 'GET', headers });
    const bodyText = await res.text();
    logger.info(`[ScheduledTaskService] <<< listTasks status=${res.status} body=${bodyText.slice(0, 500)}`);

    if (!res.ok) {
      throw new Error(`Scheduled task list failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as { success?: boolean; data?: { items?: Record<string, unknown>[] }; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task list failed');
    }

    const items = data.data?.items ?? [];
    logger.info(`[ScheduledTaskService] listTasks returned ${items.length} items`);
    return items.map(mapTask);
  }

  // -----------------------------------------------------------------------
  // Details
  // -----------------------------------------------------------------------
  async getTaskDetails(taskId: number): Promise<ScheduledTask> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/details?task_id=${encodeURIComponent(taskId)}`;
    logger.info(`[ScheduledTaskService] getTaskDetails: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task details failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task details failed');
    }

    return mapTask(data.data ?? {});
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------
  async createTask(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}`;
    logger.info(`[ScheduledTaskService] >>> createTask url=${url}`);
    logger.info(`[ScheduledTaskService] >>> createTask headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);

    const robotCode = await getRobotCode();
    const body: Record<string, unknown> = {
      name: input.name,
      cron_expr: input.cronExpr,
      ...(input.description ? { description: input.description } : {}),
      ...(input.taskType ? { task_type: input.taskType } : {}),
      ...(input.notifyMode ? { notify_mode: input.notifyMode } : {}),
      ...(input.siteCode ? { site_code: input.siteCode } : {}),
      ...(input.siteName ? { site_name: input.siteName } : {}),
      ...(input.dingdingId ? { dingding_id: input.dingdingId } : {}),
      ...(input.dingdingGroupId ? { dingding_group_id: input.dingdingGroupId } : {}),
      ...(input.dingdingGroupName ? { dingding_group_name: input.dingdingGroupName } : {}),
      ...(input.dialogSessionKey ? { dialog_session_key: input.dialogSessionKey } : {}),
      ...(input.openclawGatewayUrl ? { openclaw_gateway_url: input.openclawGatewayUrl } : {}),
      ...(input.workflowCode ? { work_flow_code: input.workflowCode } : {}),
      ...(robotCode ? { robot_code: robotCode } : {}),
    };

    const bodyJson = JSON.stringify(body);
    const curlCmd = `curl -X POST "${url}" -H "stotoken: ${headers.stotoken}" -H "Authorization: ${headers.Authorization}" -H "Content-Type: ${headers['Content-Type']}" -d '${bodyJson}'`;
    logger.info(`[ScheduledTaskService] >>> createTask curl=${curlCmd}`);

    const res = await fetch(url, { method: 'POST', headers, body: bodyJson });
    const bodyText = await res.text();
    logger.info(`[ScheduledTaskService] <<< createTask status=${res.status} body=${bodyText.slice(0, 1000)}`);

    if (!res.ok) {
      throw new Error(`Scheduled task creation failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task creation failed');
    }

    return mapTask(data.data ?? {});
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------
  async updateTask(input: ScheduledTaskUpdateInput): Promise<ScheduledTask> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/update`;
    logger.info(`[ScheduledTaskService] >>> updateTask url=${url}`);
    logger.info(`[ScheduledTaskService] >>> updateTask headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);

    const robotCode = await getRobotCode();
    const body: Record<string, unknown> = { task_id: input.taskId };
    if (input.name !== undefined) body.name = input.name;
    if (input.cronExpr !== undefined) body.cron_expr = input.cronExpr;
    if (input.description !== undefined) body.description = input.description;
    if (input.notifyMode !== undefined) body.notify_mode = input.notifyMode;
    if (input.dingdingId !== undefined) body.dingding_id = input.dingdingId;
    if (input.dingdingGroupId !== undefined) body.dingding_group_id = input.dingdingGroupId;
    if (input.dingdingGroupName !== undefined) body.dingding_group_name = input.dingdingGroupName;
    if (input.enabled !== undefined) body.enabled = input.enabled;
    if (input.workflowCode !== undefined) body.work_flow_code = input.workflowCode;
    if (robotCode !== undefined) body.robot_code = robotCode;

    const bodyJson = JSON.stringify(body);
    const curlCmd = `curl -X POST "${url}" -H "stotoken: ${headers.stotoken}" -H "Authorization: ${headers.Authorization}" -H "Content-Type: ${headers['Content-Type']}" -d '${bodyJson}'`;
    logger.info(`[ScheduledTaskService] >>> updateTask curl=${curlCmd}`);

    const res = await fetch(url, { method: 'POST', headers, body: bodyJson });
    const bodyText = await res.text();
    logger.info(`[ScheduledTaskService] <<< updateTask status=${res.status} body=${bodyText.slice(0, 1000)}`);

    if (!res.ok) {
      throw new Error(`Scheduled task update failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task update failed');
    }

    return mapTask(data.data ?? {});
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------
  async deleteTask(taskId: number): Promise<void> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/delete`;
    logger.info(`[ScheduledTaskService] deleteTask: ${taskId}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_id: taskId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task deletion failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task deletion failed');
    }
  }

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  async getTaskRuns(taskId: number): Promise<ScheduledTaskRun[]> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/${taskId}/runs`;
    logger.info(`[ScheduledTaskService] getTaskRuns: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task runs failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; data?: Array<Record<string, unknown>>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task runs failed');
    }

    const items = data.data ?? [];
    return items.map((r) => ({
      id: Number(r.id) || 0,
      taskId: Number(r.task_id) || taskId,
      status: String(r.status || ''),
      executionResult: r.execution_result != null ? String(r.execution_result) : undefined,
      logText: r.log_text != null ? String(r.log_text) : undefined,
      notifyDingtalkOk: r.notify_dingtalk_ok != null ? Boolean(r.notify_dingtalk_ok) : undefined,
    }));
  }

  // -----------------------------------------------------------------------
  // Query Runs (cloud execution results)
  // -----------------------------------------------------------------------
  async queryTaskRuns(taskId: number, executionTime?: string): Promise<ScheduledTaskRun[]> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    let url = `${baseUrl}/runs/query?task_id=${encodeURIComponent(taskId)}`;
    if (executionTime) {
      url += `&execution_time=${encodeURIComponent(executionTime)}`;
    }
    logger.info(`[ScheduledTaskService] >>> queryTaskRuns url=${url}`);
    logger.info(`[ScheduledTaskService] >>> queryTaskRuns headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);
    const curlCmd = `curl -X GET "${url}" -H "stotoken: ${headers.stotoken}" -H "Authorization: ${headers.Authorization}" -H "Content-Type: ${headers['Content-Type']}"`;
    logger.info(`[ScheduledTaskService] >>> queryTaskRuns curl=${curlCmd}`);

    const res = await fetch(url, { method: 'GET', headers });
    const bodyText = await res.text();
    logger.info(`[ScheduledTaskService] <<< queryTaskRuns status=${res.status} body=${bodyText.slice(0, 1000)}`);

    if (!res.ok) {
      throw new Error(`Scheduled task runs query failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as { success?: boolean; data?: unknown; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task runs query failed');
    }

    // 兼容多种返回结构：data 为数组 / data.items 为数组 / data 为单条对象
    let items: Array<Record<string, unknown>> = [];
    if (Array.isArray(data.data)) {
      items = data.data as Array<Record<string, unknown>>;
    } else if (data.data && typeof data.data === 'object') {
      const maybeItems = (data.data as Record<string, unknown>).items;
      if (Array.isArray(maybeItems)) {
        items = maybeItems as Array<Record<string, unknown>>;
      } else {
        // 单条记录，包装成数组
        items = [data.data as Record<string, unknown>];
      }
    }

    return items.map((r) => ({
      id: Number(r.id) || 0,
      taskId: Number(r.task_id) || taskId,
      status: String(r.status || ''),
      executionResult: r.execution_result != null ? String(r.execution_result) : undefined,
      logText: r.log_text != null ? String(r.log_text) : undefined,
      notifyDingtalkOk: r.notify_dingtalk_ok != null ? Boolean(r.notify_dingtalk_ok) : undefined,
    }));
  }

  // -----------------------------------------------------------------------
  // Trigger
  // -----------------------------------------------------------------------
  async triggerTask(taskId: number, extraInfo?: Record<string, unknown>): Promise<ScheduledTaskTriggerResponse> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/trigger`;
    logger.info(`[ScheduledTaskService] >>> triggerTask url=${url} taskId=${taskId}`);
    logger.info(`[ScheduledTaskService] >>> triggerTask headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);
    const reqBody: Record<string, unknown> = { task_id: taskId };
    if (extraInfo !== undefined) {
      reqBody.extra_info = extraInfo;
    }
    const body = JSON.stringify(reqBody);
    const curlCmd = `curl -X POST "${url}" -H "stotoken: ${headers.stotoken}" -H "Authorization: ${headers.Authorization}" -H "Content-Type: ${headers['Content-Type']}" -d '${body}'`;
    logger.info(`[ScheduledTaskService] >>> triggerTask curl=${curlCmd}`);

		// TODO====? 询问这里为什么要做 5s 超时，让状态都变为 async_started
    // [DISABLED] 移除 5s 超时，避免长时间运行的任务被误判为 async_started
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        logger.info(`[ScheduledTaskService] triggerTask timed out for task ${taskId}, treating as async execution started`);
        return {
          taskId,
          runId: 0,
          outcome: 'async_started',
        };
      }
      logger.error(`[ScheduledTaskService] triggerTask fetch error for task ${taskId}:`, err);
      throw err;
    }

    const bodyText = await res.text();
    logger.info(`[ScheduledTaskService] <<< triggerTask status=${res.status} body=${bodyText}`);

    if (!res.ok) {
      throw new Error(`Scheduled task trigger failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task trigger failed');
    }

    const d = data.data ?? {};
    const result: ScheduledTaskTriggerResponse = {
      taskId: Number(d.task_id) || taskId,
      runId: Number(d.run_id) || 0,
      outcome: String(d.outcome || ''),
      run: d.run && typeof d.run === 'object'
        ? {
            id: Number((d.run as Record<string, unknown>).id) || 0,
            taskId: Number((d.run as Record<string, unknown>).task_id) || taskId,
            status: String((d.run as Record<string, unknown>).status || ''),
            executionResult: (d.run as Record<string, unknown>).execution_result != null ? String((d.run as Record<string, unknown>).execution_result) : undefined,
            logText: (d.run as Record<string, unknown>).log_text != null ? String((d.run as Record<string, unknown>).log_text) : undefined,
            notifyDingtalkOk: (d.run as Record<string, unknown>).notify_dingtalk_ok != null ? Boolean((d.run as Record<string, unknown>).notify_dingtalk_ok) : undefined,
          }
        : undefined,
    };
    logger.info(`[ScheduledTaskService] triggerTask returned=${JSON.stringify(result)}`);
    return result;
  }
}

// Singleton instance
let scheduledTaskServiceInstance: ScheduledTaskService | null = null;

export function getScheduledTaskService(): ScheduledTaskService {
  if (!scheduledTaskServiceInstance) {
    scheduledTaskServiceInstance = new ScheduledTaskService();
  }
  return scheduledTaskServiceInstance;
}

export function resetScheduledTaskService(): void {
  scheduledTaskServiceInstance = null;
}
