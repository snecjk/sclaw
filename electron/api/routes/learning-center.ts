import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getLearningCenterTutorialDetail } from '../../services/learning-center-service';
import { StoMemoryApiError } from '../../services/sto-memory-api-fetch';
import { logger } from '../../utils/logger';

function statusOf(error: unknown) {
  return error instanceof StoMemoryApiError ? error.statusCode : 500;
}

export async function handleLearningCenterRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname !== '/api/learning-center/tutorial/detail' || req.method !== 'POST') return false;

  try {
    const body = await parseJsonBody<{ data?: { tutorialId?: number } }>(req);
    const tutorialId = Number(body.data?.tutorialId);
    if (!Number.isInteger(tutorialId) || tutorialId <= 0) {
      sendJson(res, 400, { success: false, errCode: '400', errMessage: '教程 ID 无效', data: null });
      return true;
    }
    sendJson(res, 200, await getLearningCenterTutorialDetail(tutorialId));
  } catch (error) {
    logger.error('[learning-center] request failed:', error);
    const status = statusOf(error);
    sendJson(res, status, {
      success: false,
      errCode: String(status),
      errMessage: error instanceof Error ? error.message : '教程加载失败',
      data: null,
    });
  }
  return true;
}
