import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getScheduledTaskService } from '../../scheduled-tasks/scheduled-task-service';
import {
  beautifyScheduledTaskInstruction,
  type BeautifyScheduledTaskInstructionInput,
} from '../../scheduled-tasks/scheduled-task-instruction-beautifier';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from '../../db/models/dto/schedule-task.dto';
import { getAuthState } from '../../utils/auth-store';

/** 解析当前登录用户（梧桐工号 code）作为 actor，写入 created_by/updated_by。未登录则 null。 */
async function resolveActor(): Promise<string | null> {
  const { user } = await getAuthState();
  return user?.code ?? null;
}

/**
 * 引擎无关通用定时任务路由：CRUD + setEnabled + triggerNow。
 *
 * triggerTask 的 "already has an active run" 抛错在路由层转 409（单飞语义对 UI 友好）；
 * 其余校验错（cron 非法、profile 非法等）→ 400，服务端异常 → 500。
 *
 * 注：service 在 create/update/delete/setEnabled 后已自调 `refreshSchedule`，
 * 无需额外 `/refresh` 路由。
 */
export async function handleScheduledTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // ---- list ----
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'GET') {
    try {
      const tasks = await getScheduledTaskService().listTasks();
      sendJson(res, 200, tasks);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ---- create ----
  if (url.pathname === '/api/scheduled-tasks' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<CreateScheduleTaskInput>(req);
      body.actor = await resolveActor();
      const task = await getScheduledTaskService().createTask(body);
      sendJson(res, 200, task);
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  // ---- beautify instruction: POST /beautify-instruction ----
  // 独立于 CRUD：复用 scheduled-task-instruction-beautifier 服务。
  // 输入/输出契约与前端 hostApiFetch 1:1（instruction / workflowId? / workflowName? → instruction / changed / source / model?）。
  if (url.pathname === '/api/scheduled-tasks/beautify-instruction' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<BeautifyScheduledTaskInstructionInput>(req);
      const result = await beautifyScheduledTaskInstruction(body);
      sendJson(res, 200, result);
    } catch (error) {
      const msg = String(error);
      sendJson(res, msg.includes('is required') ? 400 : 500, { success: false, error: msg });
    }
    return true;
  }

  // ---- setEnabled: POST /:id/set-enabled { enabled: boolean } ----
  if (url.pathname.endsWith('/set-enabled') && req.method === 'POST') {
    const prefix = '/api/scheduled-tasks/';
    const suffix = '/set-enabled';
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) {
      return false;
    }
    const id = decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
    if (!id || id.includes('/')) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const { enabled } = await parseJsonBody<{ enabled: boolean }>(req);
      const task = await getScheduledTaskService().setEnabled(id, !!enabled, await resolveActor());
      if (!task) {
        sendJson(res, 404, { success: false, error: `Scheduled task "${id}" not found` });
      } else {
        sendJson(res, 200, task);
      }
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  // ---- triggerNow: POST /:id/trigger ----
  if (url.pathname.endsWith('/trigger') && req.method === 'POST') {
    const prefix = '/api/scheduled-tasks/';
    const suffix = '/trigger';
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) {
      return false;
    }
    const id = decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
    if (!id || id.includes('/')) {
      sendJson(res, 400, { success: false, error: 'Invalid task id' });
      return true;
    }
    try {
      const run = await getScheduledTaskService().triggerTask(id);
      sendJson(res, 200, run);
    } catch (error) {
      const msg = String(error);
      // 单飞：已有 active run → 409（对齐 claude "already running" 语义，UI 可据此提示）
      if (msg.includes('already has an active run')) {
        sendJson(res, 409, { success: false, error: '该任务已有正在执行的运行，请稍后再试' });
      } else if (msg.includes('not found')) {
        sendJson(res, 404, { success: false, error: msg });
      } else {
        sendJson(res, 400, { success: false, error: msg });
      }
    }
    return true;
  }

  // ---- get by id ----
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.slice('/api/scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      const task = await getScheduledTaskService().getTask(id);
      if (!task) {
        sendJson(res, 404, { success: false, error: `Scheduled task "${id}" not found` });
      } else {
        sendJson(res, 200, task);
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ---- update ----
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'PUT') {
    const id = decodeURIComponent(url.pathname.slice('/api/scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      const body = await parseJsonBody<UpdateScheduleTaskInput>(req);
      body.actor = await resolveActor();
      const task = await getScheduledTaskService().updateTask(id, body);
      if (!task) {
        sendJson(res, 404, { success: false, error: `Scheduled task "${id}" not found` });
      } else {
        sendJson(res, 200, task);
      }
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  // ---- delete ----
  if (url.pathname.startsWith('/api/scheduled-tasks/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/scheduled-tasks/'.length));
    if (!id || id.includes('/')) return false;
    try {
      await getScheduledTaskService().deleteTask(id, await resolveActor());
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
