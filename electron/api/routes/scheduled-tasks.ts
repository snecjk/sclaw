import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getScheduledTaskService } from '../../services/scheduled-task-service';
import {
  appendTriggerResultToSession,
  readScheduledTaskSessionHistory,
  listAllScheduledTaskSessions,
} from '../../services/scheduled-task-session-writer';
import { ensureTaskGroupFirstTriggeredOnRun } from '../../utils/task-group-first-trigger-store';
import { stoCloudTaskGroupKey } from '../../../shared/task-group-key';

export async function handleScheduledTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // -----------------------------------------------------------------------
  // List: GET /api/scheduled-tasks
  // -----------------------------------------------------------------------
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'GET') {
    try {
      const service = getScheduledTaskService();
      const tasks = await service.listTasks();
      sendJson(res, 200, tasks);
    } catch (error) {
      const message = String(error);
      if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Details: GET /api/scheduled-tasks/:id
  // -----------------------------------------------------------------------
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'GET') {
    const idStr = url.pathname.slice('/api/scheduled-tasks/'.length);
    const id = Number(idStr);
    if (Number.isNaN(id)) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const service = getScheduledTaskService();
      const task = await service.getTaskDetails(id);
      sendJson(res, 200, task);
    } catch (error) {
      const message = String(error);
      if (message.includes('404')) {
        sendJson(res, 404, { success: false, error: message });
      } else if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Create: POST /api/scheduled-tasks
  // -----------------------------------------------------------------------
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{
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
      }>(req);
      const service = getScheduledTaskService();
      const task = await service.createTask(input);
      sendJson(res, 200, task);
    } catch (error) {
      const message = String(error);
      if (message.includes('409')) {
        sendJson(res, 409, { success: false, error: message });
      } else if (message.includes('422')) {
        sendJson(res, 422, { success: false, error: message });
      } else if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Update: PUT /api/scheduled-tasks/:id
  // -----------------------------------------------------------------------
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'PUT') {
    const idStr = url.pathname.slice('/api/scheduled-tasks/'.length);
    const id = Number(idStr);
    if (Number.isNaN(id)) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const input = await parseJsonBody<{
        name?: string;
        cronExpr?: string;
        description?: string;
        notifyMode?: string;
        enabled?: boolean;
        dingdingId?: string;
        dingdingGroupId?: string;
        dingdingGroupName?: string;
        workflowCode?: string;
      }>(req);
      const service = getScheduledTaskService();
      const task = await service.updateTask({ taskId: id, ...input });
      sendJson(res, 200, task);
    } catch (error) {
      const message = String(error);
      if (message.includes('404')) {
        sendJson(res, 404, { success: false, error: message });
      } else if (message.includes('409')) {
        sendJson(res, 409, { success: false, error: message });
      } else if (message.includes('422')) {
        sendJson(res, 422, { success: false, error: message });
      } else if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Delete: DELETE /api/scheduled-tasks/:id
  // -----------------------------------------------------------------------
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'DELETE') {
    const idStr = url.pathname.slice('/api/scheduled-tasks/'.length);
    const id = Number(idStr);
    if (Number.isNaN(id)) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const service = getScheduledTaskService();
      await service.deleteTask(id);
      sendJson(res, 200, { success: true });
    } catch (error) {
      const message = String(error);
      if (message.includes('404')) {
        sendJson(res, 404, { success: false, error: message });
      } else if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Sessions: GET /api/scheduled-tasks/sessions
  // -----------------------------------------------------------------------
  if (url.pathname === '/api/scheduled-tasks/sessions' && req.method === 'GET') {
    try {
      const sessions = await listAllScheduledTaskSessions();
      sendJson(res, 200, { sessions });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Trigger: POST /api/scheduled-tasks/:id/trigger
  // -----------------------------------------------------------------------
  if (url.pathname.endsWith('/trigger') && req.method === 'POST') {
    const prefix = '/api/scheduled-tasks/';
    const suffix = '/trigger';
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) {
      return false;
    }
    const idStr = url.pathname.slice(prefix.length, -suffix.length);
    const id = Number(idStr);
    if (Number.isNaN(id)) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const parsed = await parseJsonBody(req).catch(() => ({})) as Record<string, unknown>;
      const extraInfo = (parsed.extraInfo && typeof parsed.extraInfo === 'object')
        ? parsed.extraInfo as Record<string, unknown>
        : undefined;

      const service = getScheduledTaskService();
      const result = await service.triggerTask(id, extraInfo);

			console.log('[ScheduledTasks] Trigger result: =====>', result, id, extraInfo);
      await ensureTaskGroupFirstTriggeredOnRun(stoCloudTaskGroupKey(id));
      // Start high-frequency poll for this task to catch async completion
      try {
        const { getScheduledTaskResultPoller } = await import('../../services/scheduled-task-result-poller');
        getScheduledTaskResultPoller().startTaskPoll(id);
      } catch (pollErr) {
        console.error(`[ScheduledTasks] Failed to start task poll for ${id}:`, pollErr);
      }

      // For async execution (timed out), return immediately without waiting for result
      if (result.outcome === 'async_started') {
        sendJson(res, 200, {
          taskId: id,
          runId: 0,
          outcome: 'async_started',
          hasSession: false,
        });
        return true;
      }

      // Append result to local session if returned synchronously
      let hasSession = false;
      let executionSessionKey: string | undefined;
      let executionModel: string | undefined;
      if (result.run) {
        try {
          const task = await service.getTaskDetails(id);
          await appendTriggerResultToSession(id, task.name, result.run);
          hasSession = true;
          const today = new Date();
          const y = today.getFullYear();
          const m = String(today.getMonth() + 1).padStart(2, '0');
          const d = String(today.getDate()).padStart(2, '0');
          executionSessionKey = `agent:main:scheduled-task:${id}:${y}-${m}-${d}`;
          const runModel = typeof (result.run as { model?: unknown }).model === 'string'
            ? String((result.run as { model?: string }).model).trim()
            : '';
          if (runModel) {
            const { syncTaskExecutionModelToDatedSession } = await import(
              '../../utils/task-execution-session-model'
            );
            const synced = await syncTaskExecutionModelToDatedSession({
              sessionKey: executionSessionKey,
              model: runModel,
              engineType: 'openclaw',
              agentId: 'main',
            });
            executionModel = synced?.model || runModel;
          }
        } catch (sessionErr) {
          console.error(`[ScheduledTasks] Failed to append session for task ${id}:`, sessionErr);
        }
      }

      sendJson(res, 200, {
        ...result,
        hasSession,
        executionSessionKey,
        executionModel,
        executionAgentId: 'main',
      });
    } catch (error) {
      const message = String(error);
      if (message.includes('404')) {
        sendJson(res, 404, { success: false, error: message });
      } else if (message.includes('401') || message.includes('未登录')) {
        sendJson(res, 401, { success: false, error: message });
      } else {
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Session History: GET /api/scheduled-tasks/session-history
  // -----------------------------------------------------------------------
  if (url.pathname === '/api/scheduled-tasks/session-history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const rawLimit = Number(url.searchParams.get('limit') || '100');
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100;

    try {
      const messages = await readScheduledTaskSessionHistory(sessionKey, limit);
      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
