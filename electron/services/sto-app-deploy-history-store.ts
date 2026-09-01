/**
 * Local publish history: `<appRoot>/.sto/deploy-history.json`.
 * Records come from real siteapp deploy create/refresh, not a DevOps list API.
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  STO_DEPLOY_HISTORY_RELATIVE,
  parseStoAppDeployHistoryFile,
  serializeStoAppDeployHistoryFile,
  upsertStoAppDeployHistoryItems,
  type StoAppDeployHistoryRecord,
} from '../../shared/sto-app-deploy-history';

function historyPath(appPath: string): string {
  return join(appPath, ...STO_DEPLOY_HISTORY_RELATIVE.split('/'));
}

export async function readStoAppDeployHistory(appPath: string): Promise<StoAppDeployHistoryRecord[]> {
  try {
    const raw = JSON.parse(await readFile(historyPath(appPath), 'utf8')) as unknown;
    return parseStoAppDeployHistoryFile(raw);
  } catch {
    return [];
  }
}

export async function upsertStoAppDeployHistory(
  appPath: string,
  record: StoAppDeployHistoryRecord,
): Promise<StoAppDeployHistoryRecord[]> {
  const current = await readStoAppDeployHistory(appPath);
  const items = upsertStoAppDeployHistoryItems(current, record);
  const path = historyPath(appPath);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, serializeStoAppDeployHistoryFile(items), 'utf8');
  await rename(tmp, path);
  return items;
}
