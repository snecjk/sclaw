/**
 * Scheduled Task Service
 *
 * Proxies scheduled task endpoints from the new STO Scheduled Tasks API.
 * Uses stoToken for authentication against baseinfo-aimemory*.sto.cn.
 */

import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
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
}

export interface ScheduledTaskUpdateInput {
  taskId: number;
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
  enabled?: boolean;
}

export interface ScheduledTaskTriggerResponse {
  taskId: number;
  runId: number;
  outcome: string;
  run?: {
    id: number;
    taskId: number;
    status: string;
    executionResult?: string;
    logText?: string;
    notifyDingtalkOk?: boolean;
  };
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
    createdAt: String(t.createdAt || ''),
    updatedAt: String(t.updatedAt || ''),
  };
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
    logger.info(`[ScheduledTaskService] createTask: ${url}`);

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
    };

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task creation failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
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
    logger.info(`[ScheduledTaskService] updateTask: ${url}`);

    const body: Record<string, unknown> = { task_id: input.taskId };
    if (input.name !== undefined) body.name = input.name;
    if (input.cronExpr !== undefined) body.cron_expr = input.cronExpr;
    if (input.description !== undefined) body.description = input.description;
    if (input.notifyMode !== undefined) body.notify_mode = input.notifyMode;
    if (input.enabled !== undefined) body.enabled = input.enabled;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task update failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
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
  // Trigger
  // -----------------------------------------------------------------------
  async triggerTask(taskId: number): Promise<ScheduledTaskTriggerResponse> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/trigger`;
    logger.info(`[ScheduledTaskService] triggerTask: ${taskId}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_id: taskId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scheduled task trigger failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; errMessage?: string };
    if (data.success === false) {
      throw new Error(data.errMessage || 'Scheduled task trigger failed');
    }

    const d = data.data ?? {};
    return {
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
