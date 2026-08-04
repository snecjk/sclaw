import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { ArtifactSaveRecordRepository } from '../../db/repositories/artifact-save-record-repository';
import type { ArtifactSaveSourceType } from '../../services/data-center-artifact-sync/types';

function isSourceType(value: string | null): value is ArtifactSaveSourceType {
  return value === 'chat_artifact'
    || value === 'workflow_artifact'
    || value === 'scheduled_task_artifact';
}

export async function handleArtifactSaveRecordRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/artifact-save-records' && req.method === 'GET') {
    try {
      const sourceType = url.searchParams.get('sourceType');
      if (sourceType && !isSourceType(sourceType)) {
        sendJson(res, 400, { success: false, error: 'Invalid sourceType' });
        return true;
      }
      const repo = new ArtifactSaveRecordRepository();
      const records = await repo.list({
        sourceType: sourceType || undefined,
        sourceId: url.searchParams.get('sourceId') || undefined,
        runId: url.searchParams.get('runId') || undefined,
        limit: Number(url.searchParams.get('limit') || 100),
      });
      sendJson(res, 200, records);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
