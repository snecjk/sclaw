import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { normalizeSiteAppPageType, type SiteAppPageType } from '../../shared/site-app-catalog';
import { scanSiteappMenusFromNavSource, type SiteappMenuScanResult } from '../../shared/siteapp-menu-from-nav';
import { readStoWorkspaceFile } from './sto-workspace-store';
import { getStoAppStatus } from './sto-app-service';

function navConfigCandidates(appPath: string): string[] {
  return [
    join(appPath, 'src', 'layouts', 'nav-config.ts'),
    join(appPath, 'frontend', 'src', 'layouts', 'nav-config.ts'),
  ];
}

export async function previewSiteappMenusFromApp(input: {
  appPath: string;
  pageType?: SiteAppPageType | string | null;
  appName?: string;
}): Promise<SiteappMenuScanResult & { appCode?: string; navConfigPath?: string }> {
  const pageType = normalizeSiteAppPageType(input.pageType);
  let source = '';
  let navConfigPath: string | undefined;
  for (const candidate of navConfigCandidates(input.appPath)) {
    if (!existsSync(candidate)) continue;
    source = await readFile(candidate, 'utf8');
    navConfigPath = candidate;
    break;
  }
  const scanned = source.trim()
    ? scanSiteappMenusFromNavSource(source, { pageType, appName: input.appName })
    : { menus: [], skipped: [], source: 'empty' as const };
  const workspace = await readStoWorkspaceFile(input.appPath);
  const status = await getStoAppStatus(input.appPath).catch(() => null);
  return {
    ...scanned,
    navConfigPath,
    appCode: workspace?.appCode ?? status?.appCode,
  };
}
