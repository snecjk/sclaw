import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  clearTaskGroupFirstTriggered,
  listTaskGroupFirstTriggeredAt,
  markTaskGroupFirstTriggered,
  resetTaskGroupFirstTriggered,
} from '../../utils/task-group-first-trigger-store';

type FirstTriggerAction = 'mark' | 'reset' | 'clear';

export async function handleTaskGroupRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/task-groups/first-triggered-at' && req.method === 'GET') {
    try {
      const map = await listTaskGroupFirstTriggeredAt();
      sendJson(res, 200, { map });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/task-groups/first-triggered-at' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        groupKey?: string;
        triggeredAtMs?: number;
        action?: FirstTriggerAction;
      }>(req);
      const groupKey = (body.groupKey ?? '').trim();
      if (!groupKey) {
        sendJson(res, 400, { success: false, error: 'groupKey is required' });
        return true;
      }
      const action: FirstTriggerAction = body.action === 'reset' || body.action === 'clear'
        ? body.action
        : 'mark';

      if (action === 'clear') {
        await clearTaskGroupFirstTriggered(groupKey);
        sendJson(res, 200, { success: true, groupKey, cleared: true });
        return true;
      }

      const triggeredAtMs = action === 'reset'
        ? await resetTaskGroupFirstTriggered(groupKey, body.triggeredAtMs)
        : await markTaskGroupFirstTriggered(groupKey, body.triggeredAtMs);

      sendJson(res, 200, { success: true, groupKey, triggeredAtMs, action });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
