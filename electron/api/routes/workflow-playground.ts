import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getWorkflowService } from '../../services/workflow-service';

function mapWorkflowErrorStatus(message: string): number {
  if (message.includes('401') || message.includes('未登录')) return 401;
  if (message.includes('403')) return 403;
  return 500;
}

export async function handleWorkflowPlangroundRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  // List (aggregated): GET /api/workflows?keyword=
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    try {
      const keyword = url.searchParams.get('keyword');
      const service = getWorkflowService();
      const result = await service.listMyWorkflows(keyword);
      sendJson(res, 200, {
        success: true,
        data: result.items,
        total: result.total,
        traceId: result.traceId,
      });
    } catch (error) {
      const message = String(error);
      sendJson(res, mapWorkflowErrorStatus(message), { success: false, error: message });
    }
    return true;
  }

  // Single page: POST /api/workflows/page
  if (url.pathname === '/api/workflows/page' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{
        page?: number;
        pageSize?: number;
        createdBy?: string | null;
        keyword?: string | null;
      }>(req);
      const service = getWorkflowService();
      const result = await service.fetchWorkflowPage(input);
      sendJson(res, 200, {
        success: true,
        data: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        traceId: result.traceId,
      });
    } catch (error) {
      const message = String(error);
      sendJson(res, mapWorkflowErrorStatus(message), { success: false, error: message });
    }
    return true;
  }

  // Mine templates: GET /api/workflow-templates/mine?keyword=&page=&pageSize=
  if (url.pathname === '/api/workflow-templates/mine' && req.method === 'GET') {
    try {
      const keyword = url.searchParams.get('keyword') || undefined;
      const page = Number(url.searchParams.get('page')) || undefined;
      const pageSize = Number(url.searchParams.get('pageSize')) || undefined;
      const service = getWorkflowService();
      const result = await service.fetchMineTemplates(keyword, page, pageSize);
      sendJson(res, 200, {
        success: true,
        data: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        traceId: result.traceId,
      });
    } catch (error) {
      const message = String(error);
      sendJson(res, mapWorkflowErrorStatus(message), { success: false, error: message });
    }
    return true;
  }

  return false;
}
