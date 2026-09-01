/**
 * Local CLI submit history: `<appRoot>/.sto/push-history.json`.
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  STO_PUSH_HISTORY_RELATIVE,
  parseStoAppPushHistoryFile,
  serializeStoAppPushHistoryFile,
  upsertStoAppPushHistoryItems,
  type StoAppPushHistoryRecord,
} from '../../shared/sto-app-push-history';

function historyPath(appPath: string): string {
  return join(appPath, ...STO_PUSH_HISTORY_RELATIVE.split('/'));
}

export async function readStoAppPushHistory(appPath: string): Promise<StoAppPushHistoryRecord[]> {
  try {
    const raw = JSON.parse(await readFile(historyPath(appPath), 'utf8')) as unknown;
    return parseStoAppPushHistoryFile(raw);
  } catch {
    return [];
  }
}

export async function upsertStoAppPushHistory(
  appPath: string,
  record: StoAppPushHistoryRecord,
): Promise<StoAppPushHistoryRecord[]> {
  const current = await readStoAppPushHistory(appPath);
  const items = upsertStoAppPushHistoryItems(current, record);
  const path = historyPath(appPath);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, serializeStoAppPushHistoryFile(items), 'utf8');
  await rename(tmp, path);
  return items;
}
