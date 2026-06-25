import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getClaudeScheduledTaskService } from '../../services/claude-scheduled-task-service';
import {
  listClaudeScheduledTaskSummarySessions,
  readClaudeScheduledTaskSessionHistory,
} from '../../services/claude-scheduled-task-session-store';

export async function handleClaudeScheduledTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/claude-scheduled-tasks' && req.method === 'GET') {
    try {
      const tasks = await getClaudeScheduledTaskService().listTasks();
      sendJson(res, 200, tasks);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/claude-scheduled-tasks' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        name: string;
        enabled?: boolean;
        cronExpr: string;
        promptTemplate: string;
        agentId: string;
        workspacePath: string;
        providerAccountId?: string;
        model?: string;
        workflowId?: string;
        workflowName?: string;
        permissionProfile?: 'readonly-safe' | 'workspace-write' | 'dangerous-bypass';
        timeoutSec?: number;
        workflowCode?: string;
        retryPolicy?: {
          maxAttempts?: number;
          backoffSec?: number;
        };
        failurePolicy?: {
          pauseAfterConsecutiveFailures?: number;
        };
      }>(req);
      const task = await getClaudeScheduledTaskService().createTask(body);
      sendJson(res, 200, task);
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/claude-scheduled-tasks/scheduler-status' && req.method === 'GET') {
    try {
      const status = await getClaudeScheduledTaskService().getSchedulerStatus();
      sendJson(res, 200, status);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/claude-scheduled-tasks/sessions' && req.method === 'GET') {
    try {
      const sessions = await listClaudeScheduledTaskSummarySessions();
      sendJson(res, 200, { sessions });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/claude-scheduled-tasks/session-history' && req.method === 'GET') {
    try {
      const sessionKey = (url.searchParams.get('sessionKey') ?? '').trim();
      const limit = Number(url.searchParams.get('limit') ?? '100');
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }
      const messages = await readClaudeScheduledTaskSessionHistory(
        sessionKey,
        Number.isFinite(limit) && limit > 0 ? limit : 100,
      );
      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/claude-scheduled-tasks/refresh' && req.method === 'POST') {
    try {
      await getClaudeScheduledTaskService().refreshSchedule();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.endsWith('/trigger') && req.method === 'POST') {
    const prefix = '/api/claude-scheduled-tasks/';
    const suffix = '/trigger';
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) {
      return false;
    }

    const id = decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
    if (!id.trim()) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }

    try {
      const run = await getClaudeScheduledTaskService().triggerTask(id);
      sendJson(res, 200, run);
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/claude-scheduled-tasks/') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.slice('/api/claude-scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      const task = await getClaudeScheduledTaskService().getTask(id);
      if (!task) {
        sendJson(res, 404, { success: false, error: `Claude scheduled task "${id}" not found` });
      } else {
        sendJson(res, 200, task);
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/claude-scheduled-tasks/') && req.method === 'PUT') {
    const id = decodeURIComponent(url.pathname.slice('/api/claude-scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const task = await getClaudeScheduledTaskService().updateTask({
        id,
        ...body,
      });
      sendJson(res, 200, task);
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/claude-scheduled-tasks/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/claude-scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      await getClaudeScheduledTaskService().deleteTask(id);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
