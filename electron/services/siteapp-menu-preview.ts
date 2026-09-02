import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { normalizeSiteAppPageType, type SiteAppPageType } from '../../shared/site-app-catalog';
import {
  scanSiteappMenusFromProjectSources,
  type SiteappMenuScanResult,
} from '../../shared/siteapp-menu-from-nav';
import { readStoWorkspaceFile } from './sto-workspace-store';
import { getStoAppStatus } from './sto-app-service';

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.sto',
  '.sclaw',
  '.vite',
]);

const SOURCE_FILE_RE = /\.(?:tsx?|jsx?)$/;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 400_000;
const MAX_DEPTH = 12;

async function collectSourceTexts(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const name = entry.name;
      if (name.startsWith('.') && SKIP_DIR_NAMES.has(name)) continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name) || name.startsWith('.')) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !SOURCE_FILE_RE.test(name)) continue;
      if (/\.(?:test|spec)\.(?:tsx?|jsx?)$/.test(name) || name.endsWith('.d.ts')) continue;
      files.push(full);
    }
  }

  await walk(root, 0);
  const texts: string[] = [];
  for (const file of files) {
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) continue;
      texts.push(await readFile(file, 'utf8'));
    } catch {
      // skip unreadable files
    }
  }
  return texts;
}

export async function previewSiteappMenusFromApp(input: {
  appPath: string;
  pageType?: SiteAppPageType | string | null;
  appName?: string;
}): Promise<SiteappMenuScanResult & { appCode?: string }> {
  const pageType = normalizeSiteAppPageType(input.pageType);
  const sources = await collectSourceTexts(input.appPath);
  const scanned = scanSiteappMenusFromProjectSources(sources, {
    pageType,
    appName: input.appName,
  });
  const workspace = await readStoWorkspaceFile(input.appPath);
  const status = await getStoAppStatus(input.appPath).catch(() => null);
  return {
    ...scanned,
    appCode: workspace?.appCode ?? status?.appCode,
  };
}
