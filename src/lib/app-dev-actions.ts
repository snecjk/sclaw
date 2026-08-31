import type { DevAppSummary } from '@/lib/app-dev-api';
import type { StoAppStatus } from '@/lib/app-dev-api';

export type AppDevSource = 'created' | 'imported';

/** Local import — not created through the cloud scaffold flow. */
export function isImportedDevApp(app?: Pick<DevAppSummary, 'source' | 'appCode'> | null): boolean {
  if (!app) return false;
  if (app.source === 'imported') return true;
  if (app.source === 'created') return false;
  return !app.appCode;
}

/** sai-cli push / pull / deploy — cloud-bound apps, or apps created via 新建站. */
export function shouldShowStoCloudActions(
  app: Pick<DevAppSummary, 'source' | 'appCode'> | null | undefined,
  stoStatus?: StoAppStatus | null,
): boolean {
  if (stoStatus?.bound || stoStatus?.appCode || app?.appCode) return true;
  if (isImportedDevApp(app)) return false;
  return true;
}

/** Push / deploy pipeline — available even before first cloud registration. */
export function canUseStoCloudPipeline(
  app: Pick<DevAppSummary, 'source' | 'appCode'> | null | undefined,
  stoStatus?: StoAppStatus | null,
): boolean {
  return shouldShowStoCloudActions(app, stoStatus) && Boolean(stoStatus?.available);
}

/** Manual git commit in the workbench header — imported apps with a repo only. */
export function shouldShowGitCommitAction(
  app: Pick<DevAppSummary, 'source' | 'appCode' | 'gitRepo'> | null | undefined,
  gitAvailable: boolean,
  stoStatus?: StoAppStatus | null,
): boolean {
  if (!gitAvailable) return false;
  if (shouldShowStoCloudActions(app, stoStatus)) return false;
  if (!isImportedDevApp(app)) return false;
  return app?.gitRepo !== false;
}
