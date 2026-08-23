import type { DevAppSummary } from '@/lib/app-dev-api';
import type { StoAppStatus } from '@/lib/app-dev-api';

export type AppDevSource = 'created' | 'imported';

/** Local import — not created through the cloud scaffold flow. */
export function isImportedDevApp(app?: Pick<DevAppSummary, 'source' | 'applicationId'> | null): boolean {
  if (!app) return false;
  if (app.source === 'imported') return true;
  if (app.source === 'created') return false;
  return !app.applicationId;
}

/** sai-cli push / pull / deploy — only for apps created via 新建站. */
export function shouldShowStoCloudActions(
  app: Pick<DevAppSummary, 'source' | 'applicationId'> | null | undefined,
  stoStatus?: StoAppStatus | null,
): boolean {
  if (isImportedDevApp(app)) return false;
  if (app?.applicationId) return true;
  return Boolean(stoStatus?.bound);
}

/** Manual git commit in the workbench header — imported apps with a repo only. */
export function shouldShowGitCommitAction(
  app: Pick<DevAppSummary, 'source' | 'applicationId' | 'gitRepo'> | null | undefined,
  gitAvailable: boolean,
): boolean {
  if (!gitAvailable) return false;
  if (!isImportedDevApp(app)) return false;
  return app?.gitRepo !== false;
}
