/**
 * Persist / resolve DevOps Founder Group name for site-deployments APIs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getSiteApp } from './site-app-api';
import { readStoWorkspaceFile } from './sto-workspace-store';
import { logger } from '../utils/logger';

export const STO_DEPLOY_GROUP_RELATIVE = '.sto/deploy-group.json';

export async function readStoredDeployGroupName(appPath: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(join(appPath, STO_DEPLOY_GROUP_RELATIVE), 'utf8')) as {
      groupName?: unknown;
    };
    return typeof raw.groupName === 'string' && raw.groupName.trim() ? raw.groupName.trim() : null;
  } catch {
    return null;
  }
}

export async function writeStoredDeployGroupName(appPath: string, groupName: string): Promise<void> {
  const trimmed = groupName.trim();
  if (!trimmed) return;
  const path = join(appPath, STO_DEPLOY_GROUP_RELATIVE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, groupName: trimmed }, null, 2)}\n`, 'utf8');
}

/**
 * Resolve Founder Group for deployments:
 * 1) explicit argument
 * 2) `.sto/deploy-group.json`
 * 3) Site App detail fields
 * 4) env `STO_SITE_APP_DEPLOY_GROUP_NAME`
 */
export async function resolveDeployGroupName(
  appPath: string,
  explicit?: string | null,
): Promise<string | null> {
  const fromArg = explicit?.trim();
  if (fromArg) {
    await writeStoredDeployGroupName(appPath, fromArg).catch(() => undefined);
    return fromArg;
  }
  const stored = await readStoredDeployGroupName(appPath);
  if (stored) return stored;

  try {
    const state = await readStoWorkspaceFile(appPath);
    const appCode = state?.appCode?.trim();
    if (appCode) {
      const detail = await getSiteApp(appCode);
      const fromCloud = detail.devopsGroupName?.trim();
      if (fromCloud) {
        await writeStoredDeployGroupName(appPath, fromCloud).catch(() => undefined);
        return fromCloud;
      }
    }
  } catch (error) {
    logger.warn('[deploy-group] resolve from site-app detail failed:', error);
  }

  const fromEnv = process.env.STO_SITE_APP_DEPLOY_GROUP_NAME?.trim();
  if (fromEnv) {
    await writeStoredDeployGroupName(appPath, fromEnv).catch(() => undefined);
    return fromEnv;
  }
  return null;
}
