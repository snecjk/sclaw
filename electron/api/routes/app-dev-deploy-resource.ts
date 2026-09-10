import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseJsonBody, sendJson } from '../route-utils';
import { getWorkspaceRootPath } from '../../services/session-catalog-service';
import { getStoAppStatus } from '../../services/sto-app-service';
import { siteappCliErrorMessage } from '../../../shared/siteapp-cli-payload';

export async function handleAppDevDeployResourceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== '/api/app-dev/sto-app/deploy/resource/list' || req.method !== 'POST') {
    return false;
  }

  try {
    const body = await parseJsonBody<{
      workspaceId?: string;
      appCode?: string;
      pipelineInstanceId?: string | number;
    }>(req);
    const workspaceId = (body.workspaceId ?? '').trim();
    if (!workspaceId) throw new Error('缺少 workspaceId');

    const pipelineInstanceId = Number(body.pipelineInstanceId);
    if (!Number.isSafeInteger(pipelineInstanceId) || pipelineInstanceId <= 0) {
      throw new Error('缺少有效的 pipelineInstanceId');
    }

    let appCode = (body.appCode ?? '').trim();
    if (!appCode) {
      const appPath = await getWorkspaceRootPath(workspaceId);
      if (!appPath) throw new Error(`Workspace not found: ${workspaceId}`);
      const status = await getStoAppStatus(appPath);
      appCode = status.appCode?.trim() ?? '';
    }
    if (!appCode) throw new Error('缺少 appCode');

    const { siteappDeployResourceList } = await import('../../utils/siteapp-cli');
    const result = await siteappDeployResourceList({ appCode, pipelineInstanceId });
    if (!result.ok) throw new Error(siteappCliErrorMessage(result));

    sendJson(res, 200, {
      success: true,
      appCode,
      pipelineInstanceId,
      data: result.data ?? null,
    });
    return true;
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
