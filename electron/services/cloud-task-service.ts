/**
 * Cloud Task Service
 *
 * Proxies cloud cron task endpoints from the external cloud backend.
 * Uses stoToken for authentication against the cloud Task API.
 */

import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import type {
  CloudCronJob,
  CloudCronJobCreateInput,
  CloudCronJobUpdateInput,
  CloudTaskResult,
  CloudTaskResultList,
  CloudAgentRef,
} from '../shared/cloud-cron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudTaskListResponse {
  tasks: CloudCronJob[];
}

export interface CloudTaskCreateResponse {
  task: CloudCronJob;
}

export interface CloudTaskTriggerResponse {
  runId: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CloudTaskService {
  /**
   * Build authenticated request headers
   */
  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');
    return {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Resolve cloud Task API base URL
   * Uses the same STO domain resolution as other STO services.
   */
  private async resolveBaseUrl(): Promise<string> {
    const stoBaseUrl = await resolveStoBaseUrl();
    // Cloud Task API is mounted under /agent/v1/cloud-cron on the STO backend
    return `${stoBaseUrl}/agent/v1/cloud-cron`;
  }

  // -------------------------------------------------------------------------
  // Task CRUD
  // -------------------------------------------------------------------------

  /**
   * List all cloud tasks for the current user.
   */
  async listTasks(): Promise<CloudCronJob[]> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks`;
    logger.info(`[CloudTaskService] >>> listTasks url=${url}`);
    logger.info(`[CloudTaskService] >>> listTasks headers=${JSON.stringify({ ...headers, Authorization: '[REDACTED]', stotoken: '[REDACTED]' })}`);

    const res = await fetch(url, { method: 'GET', headers });
    const bodyText = await res.text();
    logger.info(`[CloudTaskService] <<< listTasks status=${res.status} body=${bodyText.slice(0, 500)}`);

    if (!res.ok) {
      throw new Error(`Cloud task list failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as CloudTaskListResponse;
    logger.info(`[CloudTaskService] listTasks returned ${data.tasks?.length ?? 0} tasks`);
    return data.tasks ?? [];
  }

  /**
   * Create a new cloud task.
   */
  async createTask(input: CloudCronJobCreateInput): Promise<CloudCronJob> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks`;
    logger.info(`[CloudTaskService] createTask: ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud task creation failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as CloudTaskCreateResponse;
    return data.task;
  }

  /**
   * Update an existing cloud task.
   */
  async updateTask(id: string, input: CloudCronJobUpdateInput): Promise<CloudCronJob> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks/${encodeURIComponent(id)}`;
    logger.info(`[CloudTaskService] updateTask: ${url}`);

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error(`TASK_NOT_FOUND: Cloud task ${id} not found`);
      }
      throw new Error(`Cloud task update failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as CloudTaskCreateResponse;
    return data.task;
  }

  /**
   * Delete a cloud task.
   */
  async deleteTask(id: string): Promise<void> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks/${encodeURIComponent(id)}`;
    logger.info(`[CloudTaskService] deleteTask: ${url}`);

    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud task deletion failed (${res.status}): ${text}`);
    }
  }

  /**
   * Toggle a cloud task's enabled state.
   */
  async toggleTask(id: string, enabled: boolean): Promise<void> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks/${encodeURIComponent(id)}/enabled`;
    logger.info(`[CloudTaskService] toggleTask: ${url} enabled=${enabled}`);

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud task toggle failed (${res.status}): ${text}`);
    }
  }

  /**
   * Manually trigger a cloud task.
   */
  async triggerTask(id: string): Promise<CloudTaskTriggerResponse> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${baseUrl}/tasks/${encodeURIComponent(id)}/trigger`;
    logger.info(`[CloudTaskService] triggerTask: ${url}`);

    const res = await fetch(url, { method: 'POST', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud task trigger failed (${res.status}): ${text}`);
    }

    return (await res.json()) as CloudTaskTriggerResponse;
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /**
   * Query execution results for all cloud tasks (incremental sync).
   */
  async fetchResults(params: {
    since?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CloudTaskResultList> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();

    const query = new URLSearchParams();
    if (params.since) query.set('since', params.since);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));

    const url = `${baseUrl}/results?${query.toString()}`;
    logger.info(`[CloudTaskService] fetchResults: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud result fetch failed (${res.status}): ${text}`);
    }

    return (await res.json()) as CloudTaskResultList;
  }

  /**
   * Query execution results for a specific cloud task.
   */
  async fetchTaskResults(
    taskId: string,
    params: { since?: string; cursor?: string; limit?: number } = {},
  ): Promise<CloudTaskResultList> {
    const baseUrl = await this.resolveBaseUrl();
    const headers = await this.buildHeaders();

    const query = new URLSearchParams();
    if (params.since) query.set('since', params.since);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));

    const url = `${baseUrl}/tasks/${encodeURIComponent(taskId)}/results?${query.toString()}`;
    logger.info(`[CloudTaskService] fetchTaskResults: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud task result fetch failed (${res.status}): ${text}`);
    }

    return (await res.json()) as CloudTaskResultList;
  }

  // -------------------------------------------------------------------------
  // Cloud Agents
  // -------------------------------------------------------------------------

  /**
   * List available cloud agents for the current user.
   */
  async listCloudAgents(): Promise<CloudAgentRef[]> {
    const stoBaseUrl = await resolveStoBaseUrl();
    const headers = await this.buildHeaders();
    const url = `${stoBaseUrl}/agent/v1/agents?environment=cloud`;
    logger.info(`[CloudTaskService] listCloudAgents: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud agent list failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { agents?: CloudAgentRef[] };
    return data.agents ?? [];
  }
}

// Singleton instance
let cloudTaskServiceInstance: CloudTaskService | null = null;

export function getCloudTaskService(): CloudTaskService {
  if (!cloudTaskServiceInstance) {
    cloudTaskServiceInstance = new CloudTaskService();
  }
  return cloudTaskServiceInstance;
}
