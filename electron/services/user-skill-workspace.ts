/**
 * User Skill Workspace Service
 *
 * Isolates installed skills by user code (sso user code / empCode).
 * Each user gets their own directory under ~/.stoclaw/openclaw/users/{code}/
 * containing skills/, skills-disabled/, and .clawhub/lock.json.
 *
 * The global ~/.stoclaw/openclaw/skills/ directory acts as a mount point
 * for the currently active user. Gateway always scans the global path,
 * but only the active user's skills are present there.
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import {
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  getOpenClawUserSkillsDir,
  getOpenClawUserDisabledDir,
  getOpenClawUserLockDir,
  getOpenClawUserLockPath,
} from '../utils/paths';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { TIMEOUTS } from '../utils/config';

const PREINSTALLED_MARKER_NAME = '.stoclaw-preinstalled.json';

interface UserSkillWorkspaceStore {
  currentUserCode: string | null;
  lastSyncedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

async function getStore() {
  if (!storeInstance) {
    const Store = (await import('electron-store')).default;
    storeInstance = new Store<UserSkillWorkspaceStore>({
      name: 'user-skill-workspace',
      defaults: {
        currentUserCode: null,
        lastSyncedAt: null,
      },
    });
  }
  return storeInstance;
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

export async function getCurrentActiveUserCode(): Promise<string | null> {
  const store = await getStore();
  return store.get('currentUserCode', null);
}

export async function setCurrentActiveUserCode(userCode: string | null): Promise<void> {
  const store = await getStore();
  store.set('currentUserCode', userCode);
  if (userCode) {
    store.set('lastSyncedAt', new Date().toISOString());
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getGlobalSkillsDir(): string {
  return getOpenClawSkillsDir();
}

function getGlobalDisabledDir(): string {
  return path.join(getOpenClawConfigDir(), 'skills-disabled');
}

function getGlobalLockDir(): string {
  return path.join(getOpenClawConfigDir(), '.clawhub');
}

function getGlobalLockPath(): string {
  return path.join(getGlobalLockDir(), 'lock.json');
}

function getUsersRootDir(): string {
  return path.join(getOpenClawConfigDir(), 'users');
}

function getLegacyBackupDir(): string {
  return path.join(getUsersRootDir(), '.legacy-backup', `skills-${Date.now()}`);
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isPreinstalledSkill(skillDir: string): boolean {
  const markerPath = path.join(skillDir, PREINSTALLED_MARKER_NAME);
  try {
    return fs.existsSync(markerPath);
  } catch {
    return false;
  }
}

function listSubdirs(parentDir: string): string[] {
  if (!fs.existsSync(parentDir)) return [];
  try {
    return fs
      .readdirSync(parentDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Copy a directory recursively. Overwrites existing files.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Remove all contents inside a directory but keep the directory itself.
 */
function clearDir(dir: string, preserveFilter?: (name: string, fullPath: string) => boolean): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (preserveFilter && preserveFilter(entry.name, fullPath)) {
      continue;
    }
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`[UserSkillWorkspace] Failed to remove ${fullPath}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the user's workspace directories exist.
 */
export async function ensureUserWorkspace(userCode: string): Promise<void> {
  ensureDir(getOpenClawUserSkillsDir(userCode));
  ensureDir(getOpenClawUserDisabledDir(userCode));
  ensureDir(getOpenClawUserLockDir(userCode));
}

/**
 * Copy the current global mount-point contents back to the user's workspace.
 * Preinstalled skills are skipped (they stay in global).
 */
export async function syncMountPointToUser(userCode: string): Promise<void> {
  const userSkillsDir = getOpenClawUserSkillsDir(userCode);
  const userDisabledDir = getOpenClawUserDisabledDir(userCode);
  const userLockDir = getOpenClawUserLockDir(userCode);
  const userLockPath = getOpenClawUserLockPath(userCode);

  ensureDir(userSkillsDir);
  ensureDir(userDisabledDir);
  ensureDir(userLockDir);

  const globalSkillsDir = getGlobalSkillsDir();
  const globalDisabledDir = getGlobalDisabledDir();
  const globalLockPath = getGlobalLockPath();

  // Sync skills (skip preinstalled)
  if (fs.existsSync(globalSkillsDir)) {
    for (const slug of listSubdirs(globalSkillsDir)) {
      const srcDir = path.join(globalSkillsDir, slug);
      if (isPreinstalledSkill(srcDir)) continue;
      const destDir = path.join(userSkillsDir, slug);
      await copyDir(srcDir, destDir);
    }
    // Remove skills from user dir that no longer exist in mount point
    for (const slug of listSubdirs(userSkillsDir)) {
      if (!fs.existsSync(path.join(globalSkillsDir, slug))) {
        fs.rmSync(path.join(userSkillsDir, slug), { recursive: true, force: true });
      }
    }
  }

  // Sync disabled skills (skip preinstalled)
  if (fs.existsSync(globalDisabledDir)) {
    for (const slug of listSubdirs(globalDisabledDir)) {
      const srcDir = path.join(globalDisabledDir, slug);
      if (isPreinstalledSkill(srcDir)) continue;
      const destDir = path.join(userDisabledDir, slug);
      await copyDir(srcDir, destDir);
    }
    for (const slug of listSubdirs(userDisabledDir)) {
      if (!fs.existsSync(path.join(globalDisabledDir, slug))) {
        fs.rmSync(path.join(userDisabledDir, slug), { recursive: true, force: true });
      }
    }
  }

  // Sync lock.json
  if (fs.existsSync(globalLockPath)) {
    fs.copyFileSync(globalLockPath, userLockPath);
  }

  logger.info(`[UserSkillWorkspace] Synced mount point to user ${userCode}`);
}

/**
 * Clear the global mount point, optionally preserving preinstalled skills.
 */
function clearMountPoint(): void {
  const globalSkillsDir = getGlobalSkillsDir();
  const globalDisabledDir = getGlobalDisabledDir();
  const globalLockPath = getGlobalLockPath();

  if (fs.existsSync(globalSkillsDir)) {
    clearDir(globalSkillsDir, (_name, fullPath) => isPreinstalledSkill(fullPath));
  }
  if (fs.existsSync(globalDisabledDir)) {
    clearDir(globalDisabledDir, (_name, fullPath) => isPreinstalledSkill(fullPath));
  }
  if (fs.existsSync(globalLockPath)) {
    try {
      fs.unlinkSync(globalLockPath);
    } catch (err) {
      logger.warn('[UserSkillWorkspace] Failed to remove global lock.json:', err);
    }
  }
}

/**
 * Copy a user's workspace into the global mount point.
 */
async function copyUserToMountPoint(userCode: string): Promise<void> {
  const userSkillsDir = getOpenClawUserSkillsDir(userCode);
  const userDisabledDir = getOpenClawUserDisabledDir(userCode);
  const userLockPath = getOpenClawUserLockPath(userCode);

  const globalSkillsDir = getGlobalSkillsDir();
  const globalDisabledDir = getGlobalDisabledDir();
  const globalLockDir = getGlobalLockDir();
  const globalLockPath = getGlobalLockPath();

  if (fs.existsSync(userSkillsDir)) {
    for (const slug of listSubdirs(userSkillsDir)) {
      const srcDir = path.join(userSkillsDir, slug);
      const destDir = path.join(globalSkillsDir, slug);
      await copyDir(srcDir, destDir);
    }
  }

  if (fs.existsSync(userDisabledDir)) {
    for (const slug of listSubdirs(userDisabledDir)) {
      const srcDir = path.join(userDisabledDir, slug);
      const destDir = path.join(globalDisabledDir, slug);
      await copyDir(srcDir, destDir);
    }
  }

  if (fs.existsSync(userLockPath)) {
    ensureDir(globalLockDir);
    fs.copyFileSync(userLockPath, globalLockPath);
  }
}

// ---------------------------------------------------------------------------
// Cloud sync helpers
// ---------------------------------------------------------------------------

interface CloudInstalledResponse {
  skill_slugs?: string[];
  skills?: Array<Record<string, unknown>>;
  total?: number;
}

async function fetchCloudInstalledList(): Promise<string[]> {
  const baseUrl = await resolveStoBaseUrl();
  const token = await getStoToken();
  if (!token) {
    logger.warn('[UserSkillWorkspace] Cannot fetch cloud installed list: no stoToken');
    return [];
  }
  const headers = {
    ...buildStoMemoryCenterAuthHeaders(token),
    'Content-Type': 'application/json',
  };
  const url = `${baseUrl}/agent/v1/skills/plaza/installed`;
  logger.info(`[UserSkillWorkspace] Fetching cloud installed list: ${url}`);

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cloud installed list failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data?: CloudInstalledResponse; success?: boolean; error?: string };
  if (json.success === false) {
    throw new Error(json.error || 'Cloud installed list returned business error');
  }
  return json.data?.skill_slugs || [];
}

async function downloadSkillZip(slug: string, targetDir: string): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const token = await getStoToken();
  if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

  const headers = buildStoMemoryCenterAuthHeaders(token);
  const url = `${baseUrl}/agent/v1/skills/slug/${encodeURIComponent(slug)}/download?network=external`;
  logger.info(`[UserSkillWorkspace] Downloading skill ${slug}: ${url}`);

  const res = await proxyAwareFetch(url, {
    method: 'GET',
    headers,
    timeoutMs: TIMEOUTS.SKILL_INSTALL,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`STO 技能下载失败 (${res.status}): ${text}`);
  }

  ensureDir(targetDir);
  const tmpZipPath = path.join(getOpenClawConfigDir(), `.tmp-sto-skill-${slug}-${Date.now()}.zip`);
  try {
    const body = res.body;
    if (!body) throw new Error('下载响应没有 body');
    const fileStream = createWriteStream(tmpZipPath);
    // @ts-expect-error Node fetch body is compatible with Readable
    await pipeline(body, fileStream);

    // Extract ZIP
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const isWin = process.platform === 'win32';
    if (isWin) {
      await execAsync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZipPath}' -DestinationPath '${targetDir}' -Force"`,
        { windowsHide: true },
      );
    } else {
      await execAsync(`unzip -o "${tmpZipPath}" -d "${targetDir}"`);
    }

    // Hoist nested content (same logic as StoSkillService)
    hoistZipContent(targetDir);
  } finally {
    if (fs.existsSync(tmpZipPath)) {
      fs.unlinkSync(tmpZipPath);
    }
  }
}

function hoistZipContent(targetDir: string): void {
  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) return;

  const found = findDirContaining(targetDir, 'SKILL.md');
  if (!found) {
    logger.warn(`[UserSkillWorkspace] SKILL.md not found in ${targetDir}, skipping hoist`);
    return;
  }

  const entries = fs.readdirSync(found);
  for (const name of entries) {
    const src = path.join(found, name);
    const dest = path.join(targetDir, name);
    if (fs.existsSync(dest)) continue;
    fs.renameSync(src, dest);
  }

  // Clean up empty nested dirs
  let dir = found;
  while (dir !== targetDir && dir.startsWith(targetDir)) {
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
      } else {
        break;
      }
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

function findDirContaining(dir: string, fileName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(dir, entry.name);
      if (fs.existsSync(path.join(subDir, fileName))) {
        return subDir;
      }
      const deeper = findDirContaining(subDir, fileName);
      if (deeper) return deeper;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Download missing skills from cloud and place them into both user workspace and mount point.
 */
async function downloadMissingSkills(
  userCode: string,
  cloudSlugs: string[],
): Promise<{ downloaded: string[]; failed: string[] }> {
  const userSkillsDir = getOpenClawUserSkillsDir(userCode);
  const globalSkillsDir = getGlobalSkillsDir();
  const downloaded: string[] = [];
  const failed: string[] = [];

  for (const slug of cloudSlugs) {
    const userSkillDir = path.join(userSkillsDir, slug);
    if (fs.existsSync(path.join(userSkillDir, 'SKILL.md'))) {
      // Already present locally, just sync to mount point
      const mountDir = path.join(globalSkillsDir, slug);
      if (!fs.existsSync(mountDir)) {
        await copyDir(userSkillDir, mountDir);
      }
      continue;
    }

    try {
      const tmpExtractDir = path.join(userSkillsDir, `.tmp-${slug}-${Date.now()}`);
      ensureDir(tmpExtractDir);
      await downloadSkillZip(slug, tmpExtractDir);

      // If extraction created a nested folder, find the actual skill dir
      const finalDir = findDirContaining(tmpExtractDir, 'SKILL.md') || tmpExtractDir;
      const targetUserDir = path.join(userSkillsDir, slug);
      ensureDir(targetUserDir);

      // Move contents from finalDir to targetUserDir
      const entries = fs.readdirSync(finalDir);
      for (const name of entries) {
        const src = path.join(finalDir, name);
        const dest = path.join(targetUserDir, name);
        if (src !== targetUserDir && !dest.startsWith(src)) {
          if (fs.existsSync(dest)) {
            fs.rmSync(dest, { recursive: true, force: true });
          }
          fs.renameSync(src, dest);
        }
      }

      // Clean up tmp dir
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });

      // Sync to mount point
      const mountDir = path.join(globalSkillsDir, slug);
      await copyDir(targetUserDir, mountDir);

      downloaded.push(slug);
      logger.info(`[UserSkillWorkspace] Downloaded and installed skill ${slug} for user ${userCode}`);
    } catch (err) {
      logger.error(`[UserSkillWorkspace] Failed to download skill ${slug}:`, err);
      failed.push(slug);
    }
  }

  return { downloaded, failed };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function detectLegacyGlobalSkills(): boolean {
  const usersRoot = getUsersRootDir();
  if (fs.existsSync(usersRoot)) {
    // If users/ exists and is non-empty (excluding hidden dirs), assume feature already enabled
    const entries = fs.readdirSync(usersRoot, { withFileTypes: true });
    const hasUserDirs = entries.some((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (hasUserDirs) return false;
  }

  const globalSkillsDir = getGlobalSkillsDir();
  if (!fs.existsSync(globalSkillsDir)) return false;

  // Check if there is any non-preinstalled skill
  const entries = fs.readdirSync(globalSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(globalSkillsDir, entry.name);
    if (!isPreinstalledSkill(skillDir)) {
      return true;
    }
  }
  return false;
}

async function migrateLegacySkillsToUser(userCode: string): Promise<void> {
  const backupDir = getLegacyBackupDir();
  ensureDir(backupDir);

  const globalSkillsDir = getGlobalSkillsDir();
  const globalDisabledDir = getGlobalDisabledDir();
  const globalLockPath = getGlobalLockPath();

  const userSkillsDir = getOpenClawUserSkillsDir(userCode);
  const userDisabledDir = getOpenClawUserDisabledDir(userCode);
  const userLockDir = getOpenClawUserLockDir(userCode);
  const userLockPath = getOpenClawUserLockPath(userCode);

  ensureDir(userSkillsDir);
  ensureDir(userDisabledDir);
  ensureDir(userLockDir);

  // Backup global state first
  if (fs.existsSync(globalSkillsDir)) {
    const backupSkillsDir = path.join(backupDir, 'skills');
    await copyDir(globalSkillsDir, backupSkillsDir);
  }
  if (fs.existsSync(globalDisabledDir)) {
    const backupDisabledDir = path.join(backupDir, 'skills-disabled');
    await copyDir(globalDisabledDir, backupDisabledDir);
  }
  if (fs.existsSync(globalLockPath)) {
    fs.copyFileSync(globalLockPath, path.join(backupDir, 'lock.json'));
  }

  // Migrate non-preinstalled skills to user
  if (fs.existsSync(globalSkillsDir)) {
    for (const slug of listSubdirs(globalSkillsDir)) {
      const srcDir = path.join(globalSkillsDir, slug);
      if (isPreinstalledSkill(srcDir)) continue;
      const destDir = path.join(userSkillsDir, slug);
      await copyDir(srcDir, destDir);
    }
  }
  if (fs.existsSync(globalDisabledDir)) {
    for (const slug of listSubdirs(globalDisabledDir)) {
      const srcDir = path.join(globalDisabledDir, slug);
      if (isPreinstalledSkill(srcDir)) continue;
      const destDir = path.join(userDisabledDir, slug);
      await copyDir(srcDir, destDir);
    }
  }
  if (fs.existsSync(globalLockPath)) {
    fs.copyFileSync(globalLockPath, userLockPath);
  }

  logger.info(`[UserSkillWorkspace] Migrated legacy skills to user ${userCode}, backup at ${backupDir}`);
}

// ---------------------------------------------------------------------------
// Main activation flow
// ---------------------------------------------------------------------------

export interface ActivateWorkspaceResult {
  userChanged: boolean;
  migrated: boolean;
  downloaded: string[];
  failed: string[];
}

/**
 * Activate a user's skill workspace.
 *
 * Steps:
 * 1. If legacy global skills exist and users/ is empty, migrate to this user.
 * 2. If there is a previously active user, sync mount point back to that user.
 * 3. Clear mount point (preserve preinstalled skills).
 * 4. Copy new user's workspace to mount point.
 * 5. Fetch cloud installed list and download missing skills.
 * 6. Update current active user.
 */
export async function activateUserWorkspace(userCode: string): Promise<ActivateWorkspaceResult> {
  const previousUserCode = await getCurrentActiveUserCode();
  const result: ActivateWorkspaceResult = {
    userChanged: previousUserCode !== userCode,
    migrated: false,
    downloaded: [],
    failed: [],
  };

  if (previousUserCode && previousUserCode !== userCode) {
    // Save previous user's state
    await syncMountPointToUser(previousUserCode);
    logger.info(`[UserSkillWorkspace] Saved mount point to previous user ${previousUserCode}`);
  }

  // Migration
  if (detectLegacyGlobalSkills()) {
    await migrateLegacySkillsToUser(userCode);
    result.migrated = true;
  }

  // Ensure user workspace exists
  await ensureUserWorkspace(userCode);

  // Clear mount point and copy new user data
  clearMountPoint();
  await copyUserToMountPoint(userCode);

  // Fetch cloud installed list and download missing skills
  try {
    const cloudSlugs = await fetchCloudInstalledList();
    const downloadResult = await downloadMissingSkills(userCode, cloudSlugs);
    result.downloaded = downloadResult.downloaded;
    result.failed = downloadResult.failed;
  } catch (err) {
    logger.warn('[UserSkillWorkspace] Failed to sync with cloud installed list:', err);
  }

  // Save current user
  await setCurrentActiveUserCode(userCode);

  logger.info(
    `[UserSkillWorkspace] Activated workspace for user ${userCode}. ` +
    `migrated=${result.migrated}, downloaded=${result.downloaded.length}, failed=${result.failed.length}`,
  );

  return result;
}
