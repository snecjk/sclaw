import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StorageCleanupPolicy, StorageCleanupRequest, StorageOpenRequest } from '../../../shared/storage-management';
import { storageManagementService } from '../../services/storage-management-service';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function isOpenClawInUse(ctx: HostApiContext): boolean {
  return ctx.gatewayManager.getStatus().state === 'running';
}

function isStorageCleanupPolicy(value: unknown): value is StorageCleanupPolicy {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  const policy = value as { kind?: unknown; days?: unknown };
  if (policy.kind === 'all') return policy.days === undefined;
  return policy.kind === 'older-than' && (policy.days === 7 || policy.days === 30 || policy.days === 90);
}

export async function handleStorageRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/storage/overview' && req.method === 'GET') {
    if (url.searchParams.get('background') === '1' && await storageManagementService.hasActiveWork()) {
      sendJson(res, 202, { deferred: true });
      return true;
    }
    const overview = await storageManagementService.overview({
      openClawInUse: isOpenClawInUse(ctx),
    });
    sendJson(res, 200, overview);
    return true;
  }

  if (url.pathname === '/api/storage/refresh' && req.method === 'POST') {
    const overview = await storageManagementService.overview({
      force: true,
      openClawInUse: isOpenClawInUse(ctx),
    });
    sendJson(res, 200, overview);
    return true;
  }

  if (url.pathname === '/api/storage/cleanup' && req.method === 'POST') {
    const body = await parseJsonBody<StorageCleanupRequest>(req, { maxBytes: 32 * 1024, timeoutMs: 10_000 });
    if ((body.mode !== 'trash' && body.mode !== 'delete') || !Array.isArray(body.targetIds) || body.targetIds.length === 0 || !isStorageCleanupPolicy(body.policy)) {
      sendJson(res, 400, { success: false, error: 'targetIds and a valid cleanup mode are required' });
      return true;
    }
    if (body.targetIds.length > 500 || body.targetIds.some((id) => typeof id !== 'string' || id.length > 180)) {
      sendJson(res, 400, { success: false, error: 'Invalid storage cleanup targets' });
      return true;
    }
    const result = await storageManagementService.cleanup(body.targetIds, {
      mode: body.mode,
      openClawInUse: isOpenClawInUse(ctx),
      ...(body.policy ? { policy: body.policy } : {}),
    });
    sendJson(res, 200, result);
    return true;
  }


  if (url.pathname === '/api/storage/open' && req.method === 'POST') {
    const body = await parseJsonBody<StorageOpenRequest>(req, { maxBytes: 4 * 1024, timeoutMs: 10_000 });
    if (typeof body.targetId !== 'string' || body.targetId.length > 180) {
      sendJson(res, 400, { opened: false, errorCode: 'TARGET_NOT_FOUND' });
      return true;
    }
    const result = await storageManagementService.openWorkspaceArtifactsFolder(body.targetId);
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
