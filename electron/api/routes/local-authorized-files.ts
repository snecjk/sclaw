import type { IncomingMessage, ServerResponse } from 'http';
import { dialog, shell } from 'electron';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  addLocalAuthorizedPaths,
  getLocalAuthorizedPathFromEntryId,
  listLocalAuthorizedFiles,
  removeLocalAuthorizedEntry,
  renameLocalAuthorizedEntry,
} from '../../services/local-authorized-files-service';

function resolveStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}

function decodeEntryIdFromPath(pathname: string, suffix = ''): string {
  const base = '/api/local-authorized-files/entries/';
  const encoded = pathname.slice(base.length, suffix ? -suffix.length : undefined);
  return decodeURIComponent(encoded);
}

export async function handleLocalAuthorizedFileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/local-authorized-files/entries' && req.method === 'GET') {
    try {
      const result = await listLocalAuthorizedFiles({
        parentEntryId: url.searchParams.get('parentEntryId') || 'root',
        keyword: url.searchParams.get('keyword') || '',
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, resolveStatusCode(error), { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/local-authorized-files/authorize' && req.method === 'POST') {
    try {
      const options: Electron.OpenDialogOptions = {
        title: '授权本地文件',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
      };
      const result = ctx.mainWindow
        ? await dialog.showOpenDialog(ctx.mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        sendJson(res, 200, {
          ...await listLocalAuthorizedFiles({ parentEntryId: 'root' }),
          canceled: true,
        });
        return true;
      }
      sendJson(res, 200, await addLocalAuthorizedPaths(result.filePaths));
    } catch (error) {
      sendJson(res, resolveStatusCode(error), { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/local-authorized-files/entries/') && url.pathname.endsWith('/reveal') && req.method === 'POST') {
    try {
      const entryId = decodeEntryIdFromPath(url.pathname, '/reveal');
      const filePath = getLocalAuthorizedPathFromEntryId(entryId);
      shell.showItemInFolder(filePath);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, resolveStatusCode(error), { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/local-authorized-files/entries/') && req.method === 'PATCH') {
    try {
      const entryId = decodeEntryIdFromPath(url.pathname);
      const body = await parseJsonBody<{ name?: string }>(req);
      const entry = await renameLocalAuthorizedEntry(entryId, body.name ?? '');
      sendJson(res, 200, entry);
    } catch (error) {
      sendJson(res, resolveStatusCode(error), { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/local-authorized-files/entries/') && req.method === 'DELETE') {
    try {
      const entryId = decodeEntryIdFromPath(url.pathname);
      sendJson(res, 200, await removeLocalAuthorizedEntry(entryId));
    } catch (error) {
      sendJson(res, resolveStatusCode(error), { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}
