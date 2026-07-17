/**
 * STO Skill Service
 * Manages downloading and installing skills from the STO AI Memory Center backend.
 * Mirrors the ClawHubService interface for consistency.
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

import { getOpenClawConfigDir, getOpenClawSkillsDir, getOpenClawAgentSkillsDir, getOpenClawUserSkillsDir, getOpenClawUserDisabledDir, getOpenClawUserLockPath } from '../utils/paths';
import { syncBaseAgentSkillInstall, syncBaseAgentSkillUninstall } from './project-agent-service';
import { getStoToken } from '../utils/auth-store';
import { getCurrentActiveUserCode } from './user-skill-workspace';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { TIMEOUTS } from '../utils/config';
import { normalizeSkillVersion } from '../utils/skill-version';
import { readSkillMdFrontmatter } from '../utils/skill-frontmatter';
import { safeRemoveDir } from '../utils/fs-retry';

export const PREINSTALLED_MARKER_NAME = '.stoclaw-preinstalled.json';

export const USER_UPLOAD_MARKER_NAME = '.stoclaw-user-upload.json';

export interface StoSkillSearchParams {
  query?: string;
  limit?: number;
}

export interface StoSkillInstallParams {
  slug: string;
  version?: string;
  force?: boolean;
  // Metadata from search results, saved to lock.json for display
  name?: string;
  description?: string;
  author?: string;
  // If set, install into agent-scoped directory instead of global skills dir
  agentId?: string;
}

export interface StoSkillUninstallParams {
  slug: string;
  // If set, uninstall from agent-scoped directory instead of global skills dir
  agentId?: string;
}

export interface StoSkillResult {
  slug: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  downloads?: number;
  stars?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StoSkillService {
  private workDir: string;
  private skillsDir: string;
  private installLocks: Map<string, Promise<void>> = new Map();

  constructor() {
    this.workDir = getOpenClawConfigDir();
    this.skillsDir = getOpenClawSkillsDir();
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  private getDisabledDir(): string {
    return path.join(this.workDir, 'skills-disabled');
  }

  /**
   * Search / list skills from STO marketplace.
   */
  async search(params: StoSkillSearchParams): Promise<StoSkillResult[]> {
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const headers = {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
    };

    const qs = new URLSearchParams();
    if (params.query) qs.set('search', params.query);
    if (params.limit) qs.set('limit', String(params.limit));

    const url = `${baseUrl}/agent/v1/skills/marketplace?${qs.toString()}`;
    logger.info(`[StoSkillService] search: ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    logger.info(`[StoSkillService] search: ${res.status} ${res.statusText} ${res.body}`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 技能搜索失败 (${res.status}): ${text}`);
    }

    const json = await res.json() as {
      data?: Array<Record<string, unknown>>;
    };

    const items = json.data ?? [];
    return items.map((item) => ({
      slug: String(item.skill_slug || item.slug || ''),
      name: String(item.name || item.skill_name || item.skill_slug || ''),
      description: String(item.short_description || item.description || ''),
      version: String(item.version || '1.0.0'),
      author: item.author_name ? String(item.author_name) : undefined,
      downloads: typeof item.install_count === 'number' ? item.install_count : undefined,
    }));
  }

  /**
   * Download & install a skill from STO by slug.
   * Steps:
   *   1. Download ZIP via GET /agent/v1/skills/slug/{slug}/download
   *   2. Extract to ~/.stoclaw/openclaw/skills/{slug}/
   *   3. Update lock.json
   */
  async install(params: StoSkillInstallParams): Promise<void> {
    // Prevent concurrent installs for the same skill slug
    while (this.installLocks.has(params.slug)) {
      logger.info(`[StoSkillService] install: waiting for previous install of ${params.slug} to complete`);
      await this.installLocks.get(params.slug);
    }

    const installPromise = this.doInstall(params);
    this.installLocks.set(params.slug, installPromise);

    try {
      await installPromise;
    } finally {
      this.installLocks.delete(params.slug);
    }
  }

  private async doInstall(params: StoSkillInstallParams): Promise<void> {
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const headers = buildStoMemoryCenterAuthHeaders(token);
    const url = `${baseUrl}/agent/v1/skills/slug/${encodeURIComponent(params.slug)}/download?network=external`;
    logger.info(`[StoSkillService] install: downloading ${url}`);

    const res = await proxyAwareFetch(url, {
      method: 'GET',
      headers,
      timeoutMs: TIMEOUTS.SKILL_INSTALL,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 技能下载失败 (${res.status}): ${text}`);
    }

    // Determine install directory: agent-scoped or global
    const isGlobal = !params.agentId;
    const skillsDir = params.agentId
      ? getOpenClawAgentSkillsDir(params.agentId)
      : this.skillsDir;
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    // For global installs, also determine user-scoped directory
    let userSkillsDir: string | null = null;
    let userCode: string | null = null;
    if (isGlobal) {
      userCode = await getCurrentActiveUserCode();
      if (userCode) {
        userSkillsDir = getOpenClawUserSkillsDir(userCode);
        if (!fs.existsSync(userSkillsDir)) {
          fs.mkdirSync(userSkillsDir, { recursive: true });
        }
      }
    }

    // Save to a temp file, extract to staging, then atomically promote to target.
    const tmpZipPath = path.join(this.workDir, `.tmp-sto-skill-${params.slug}-${Date.now()}.zip`);
    const stagingDir = path.join(this.workDir, `.tmp-sto-skill-staging-${params.slug}-${Date.now()}`);
    let stagingActive = false;
    try {
      const body = res.body;
      if (!body) throw new Error('下载响应没有 body');

      // Node 18+ fetch body is a ReadableStream; pipe to disk
      const fileStream = createWriteStream(tmpZipPath);
      await pipeline(body, fileStream);

      fs.mkdirSync(stagingDir, { recursive: true });
      stagingActive = true;
      await this.extractZip(tmpZipPath, stagingDir);

      // Ensure SKILL.md has proper frontmatter so Gateway can load it.
      // Gateway requires at least a `description` in frontmatter, and uses
      // `name` to identify the skill (falls back to directory name otherwise).
      // Gateway requires name to match /^[a-z0-9-]+$/, so we use lowercase slug.
      this.ensureSkillFrontmatter(stagingDir, params.slug, {
        name: params.name,
        description: params.description,
      });

      const targetDir = path.join(skillsDir, params.slug);
      await this.promoteStagedSkillDir(stagingDir, targetDir, Boolean(params.force));
      stagingActive = false;

      // For global installs, also copy to user workspace
      if (userSkillsDir) {
        const userTargetDir = path.join(userSkillsDir, params.slug);
        if (params.force && fs.existsSync(userTargetDir)) {
          await safeRemoveDir(userTargetDir, { label: userTargetDir });
        }
        await this.copyDir(targetDir, userTargetDir);
        logger.info(`[StoSkillService] install: ${params.slug} copied to user workspace ${userTargetDir}`);
      }

      // Update lock.json with metadata from search results
      this.updateLockFile(params.slug, {
        version: params.version || '1.0.0',
        name: params.name,
        description: params.description,
        author: params.author,
        versionSource: 'install',
      });

      // Also update user lock file if applicable
      if (userCode) {
        this.updateUserLockFile(userCode, params.slug, {
          version: params.version || '1.0.0',
          name: params.name,
          description: params.description,
          author: params.author,
          versionSource: 'install',
        });
      }

      logger.info(`[StoSkillService] install: ${params.slug} installed to ${targetDir}`);

      // Mirror agent-scoped installs to any project agents derived from this base agent.
      if (params.agentId) {
        await syncBaseAgentSkillInstall(params.agentId, params.slug).catch((error) => {
          logger.warn('[StoSkillService] failed to mirror skill install to project agents', { agentId: params.agentId, slug: params.slug, error });
        });
      }
    } finally {
      if (stagingActive && fs.existsSync(stagingDir)) {
        await safeRemoveDir(stagingDir, { label: stagingDir }).catch(() => {});
      }
      // Clean up temp file
      if (fs.existsSync(tmpZipPath)) {
        fs.unlinkSync(tmpZipPath);
      }
    }

    logger.info(`[StoSkillService] install: ${params.slug} installed to ${path.join(skillsDir, params.slug)}`);
  }

  /**
   * Upload and install a skill from a local ZIP file or folder.
   * Detects the path type: ZIP file -> extract; folder -> copy directly.
   * Then unifies slug derivation, atomic placement, and marker writing.
   */
  async uploadSkill(filePath: string): Promise<{ slug: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Path not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const isDirectory = stat.isDirectory();

    // Stage the skill contents into a temp directory
    const stagingDir = path.join(this.workDir, `.tmp-skill-upload-staging-${Date.now()}`);
    let stagingActive = false;
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      stagingActive = true;

      if (isDirectory) {
        // Folder input: copy contents directly (no extraction)
        for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
          fs.cpSync(
            path.join(filePath, entry.name),
            path.join(stagingDir, entry.name),
            { recursive: true, force: true },
          );
        }
      } else if (path.basename(filePath).toLowerCase() === 'skill.md') {
        fs.copyFileSync(filePath, path.join(stagingDir, 'SKILL.md'));
      } else {
        // ZIP file input: extract into staging
        const { extractZip } = await import('../utils/zip-extract');
        await extractZip(filePath, stagingDir);
      }

      // Validate the skill package (placeholder - rules TBD with product)
      this.validateSkillPackage(stagingDir);

      // Find SKILL.md - it may be at the root or inside a single nested folder
      let skillDir = stagingDir;
      if (!fs.existsSync(path.join(stagingDir, 'SKILL.md'))) {
        const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
        const nested = entries.find(
          (e) => e.isDirectory() && fs.existsSync(path.join(stagingDir, e.name, 'SKILL.md')),
        );
        if (nested) {
          skillDir = path.join(stagingDir, nested.name);
        } else {
          throw new Error('未找到 SKILL.md，请确认压缩包或文件夹结构正确');
        }
      }

      // Read slug from SKILL.md frontmatter name field
      const fm = readSkillMdFrontmatter(skillDir);
      const rawName = fm?.name?.trim();
      if (!rawName) {
        throw new Error('SKILL.md frontmatter 中未找到 name 字段，无法确定技能标识');
      }
      // Gateway requires name to match /^[a-z0-9-]+$/
      const slug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!slug) {
        throw new Error(`从 SKILL.md name 字段解析 slug 失败: ${rawName}`);
      }

      // Ensure frontmatter has a Gateway-compatible name
      this.ensureSkillFrontmatter(skillDir, slug, {
        name: fm?.name,
        description: fm?.description,
      });

      // Atomically promote the skill directory -> target.
      // Use skillDir (not stagingDir) so nested-folder structures are hoisted correctly.
      const targetDir = path.join(this.skillsDir, slug);
      await this.promoteStagedSkillDir(skillDir, targetDir, true);
      stagingActive = false;

      // Write user-upload marker so the skill shows up in the 其他 category
      const markerPath = path.join(targetDir, USER_UPLOAD_MARKER_NAME);
      const markerPayload = {
        source: 'user-upload',
        slug,
        uploadedAt: new Date().toISOString(),
      };
      fs.writeFileSync(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf-8');

      // Sync to user workspace if applicable
      const userCode = await getCurrentActiveUserCode();
      if (userCode) {
        const userSkillsDir = getOpenClawUserSkillsDir(userCode);
        if (!fs.existsSync(userSkillsDir)) {
          fs.mkdirSync(userSkillsDir, { recursive: true });
        }
        const userTargetDir = path.join(userSkillsDir, slug);
        if (fs.existsSync(userTargetDir)) {
          await safeRemoveDir(userTargetDir, { label: userTargetDir });
        }
        await this.copyDir(targetDir, userTargetDir);
        // Also write marker in user workspace copy
        const userMarkerPath = path.join(userTargetDir, USER_UPLOAD_MARKER_NAME);
        fs.writeFileSync(userMarkerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf-8');
        logger.info(`[StoSkillService] uploadSkill: ${slug} synced to user workspace ${userTargetDir}`);
      }

      logger.info(`[StoSkillService] uploadSkill: ${slug} installed to ${targetDir}`);
      return { slug };
    } finally {
      if (stagingActive && fs.existsSync(stagingDir)) {
        await safeRemoveDir(stagingDir, { label: stagingDir }).catch(() => {});
      }
    }
  }

  /**
   * Validate a skill package after staging.
   * Placeholder - specific validation rules TBD with product team.
   * Currently only checks that SKILL.md exists.
   */
  private validateSkillPackage(stagingDir: string): void {
    // Check root level
    if (fs.existsSync(path.join(stagingDir, 'SKILL.md'))) return;
    // Check single nested folder
    const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
    const hasNestedSkill = entries.some(
      (e) => e.isDirectory() && fs.existsSync(path.join(stagingDir, e.name, 'SKILL.md')),
    );
    if (!hasNestedSkill) {
      throw new Error('未找到 SKILL.md，请确认压缩包或文件夹结构正确');
    }
  }

  /**
   * Uninstall a skill (same as ClawHub: delete dir + update lock).
   */
  async uninstall(params: StoSkillUninstallParams): Promise<void> {
    const isGlobal = !params.agentId;
    const skillsDir = params.agentId
      ? getOpenClawAgentSkillsDir(params.agentId)
      : this.skillsDir;
    const skillDir = path.join(skillsDir, params.slug);
    const disabledDir = path.join(this.getDisabledDir(), params.slug);
    if (fs.existsSync(skillDir)) {
      logger.info(`[StoSkillService] uninstall: removing ${skillDir}`);
      await safeRemoveDir(skillDir, { label: skillDir });
    }
    if (fs.existsSync(disabledDir)) {
      logger.info(`[StoSkillService] uninstall: removing disabled ${disabledDir}`);
      await safeRemoveDir(disabledDir, { label: disabledDir });
    }

    // For global uninstall, also remove from user workspace
    if (isGlobal) {
      const userCode = await getCurrentActiveUserCode();
      if (userCode) {
        const userSkillDir = path.join(getOpenClawUserSkillsDir(userCode), params.slug);
        const userDisabledDir = path.join(getOpenClawUserDisabledDir(userCode), params.slug);
        if (fs.existsSync(userSkillDir)) {
          await safeRemoveDir(userSkillDir, { label: userSkillDir });
        }
        if (fs.existsSync(userDisabledDir)) {
          await safeRemoveDir(userDisabledDir, { label: userDisabledDir });
        }
      }
    }

    // Remove from lock.json
    const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
    if (fs.existsSync(lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (lockData.skills && lockData.skills[params.slug]) {
          delete lockData.skills[params.slug];
          await fs.promises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
        }
      } catch (err) {
        logger.warn('[StoSkillService] Failed to update lock file:', err);
      }
    }

    // Remove from user lock.json
    if (isGlobal) {
      const userCode = await getCurrentActiveUserCode();
      if (userCode) {
        const userLockFile = getOpenClawUserLockPath(userCode);
        if (fs.existsSync(userLockFile)) {
          try {
            const lockData = JSON.parse(fs.readFileSync(userLockFile, 'utf8'));
            if (lockData.skills && lockData.skills[params.slug]) {
              delete lockData.skills[params.slug];
              await fs.promises.writeFile(userLockFile, JSON.stringify(lockData, null, 2));
            }
          } catch (err) {
            logger.warn('[StoSkillService] Failed to update user lock file:', err);
          }
        }
      }
    }

    // Mirror agent-scoped uninstalls to any project agents derived from this base agent.
    if (params.agentId) {
      await syncBaseAgentSkillUninstall(params.agentId, params.slug).catch((error) => {
        logger.warn('[StoSkillService] failed to mirror skill uninstall to project agents', { agentId: params.agentId, slug: params.slug, error });
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async copyDir(src: string, dest: string): Promise<void> {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
  }

  /**
   * Promote a fully extracted staging directory into the final skill location.
   * Uses rename-with-backup on force updates so a failed swap restores the old copy.
   */
  private async promoteStagedSkillDir(stagingDir: string, targetDir: string, force: boolean): Promise<void> {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });

    if (!force && fs.existsSync(targetDir)) {
      await this.copyDir(stagingDir, targetDir);
      await safeRemoveDir(stagingDir, { label: stagingDir });
      return;
    }

    if (fs.existsSync(targetDir)) {
      const backupDir = `${targetDir}.old-${Date.now()}`;
      await fs.promises.rename(targetDir, backupDir);
      try {
        await fs.promises.rename(stagingDir, targetDir);
        await safeRemoveDir(backupDir, { label: backupDir });
      } catch (error) {
        if (!fs.existsSync(targetDir) && fs.existsSync(backupDir)) {
          await fs.promises.rename(backupDir, targetDir).catch(() => {});
        } else if (fs.existsSync(backupDir)) {
          await safeRemoveDir(backupDir, { label: backupDir }).catch(() => {});
        }
        if (fs.existsSync(stagingDir)) {
          await safeRemoveDir(stagingDir, { label: stagingDir }).catch(() => {});
        }
        throw error;
      }
      return;
    }

    await fs.promises.rename(stagingDir, targetDir);
  }

  private async extractZip(zipPath: string, targetDir: string): Promise<void> {
    const { extractZip: unifiedExtractZip } = await import('../utils/zip-extract');
    await unifiedExtractZip(zipPath, targetDir);

    // ZIP packages often contain a single root folder (e.g. "name-1.0.0/SKILL.md").
    // The gateway expects SKILL.md directly inside targetDir.
    // Recursively find the directory containing SKILL.md and hoist its contents.
    await this.hoistSkillContent(targetDir);
  }

  /**
   * If SKILL.md is not directly in targetDir but buried in nested sub-directories,
   * move the contents of the directory containing SKILL.md up to targetDir.
   */
  private async hoistSkillContent(targetDir: string): Promise<void> {
    // Already good – SKILL.md is directly in targetDir
    if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) return;

    // Recursively search for SKILL.md
    const skillMdDir = this.findDirContaining(targetDir, 'SKILL.md');
    if (!skillMdDir) {
      logger.warn(`[StoSkillService] SKILL.md not found in ${targetDir}, skipping hoist`);
      return;
    }

    logger.info(`[StoSkillService] found SKILL.md in nested dir: ${skillMdDir}, hoisting to ${targetDir}`);

    // Move all contents from the found directory up to targetDir.
    // If a destination already exists and is a directory (e.g. nested dir with same name as targetDir),
    // merge by moving its contents instead of skipping.
    const entries = fs.readdirSync(skillMdDir);
    for (const name of entries) {
      const src = path.join(skillMdDir, name);
      const dest = path.join(targetDir, name);
      if (fs.existsSync(dest)) {
        // Dest exists and is a directory: merge contents
        if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
          const subEntries = fs.readdirSync(src);
          for (const subName of subEntries) {
            const subSrc = path.join(src, subName);
            const subDest = path.join(dest, subName);
            if (!fs.existsSync(subDest)) {
              await fs.promises.rename(subSrc, subDest);
            }
          }
          // Remove empty source subdir after merge
          try {
            fs.rmdirSync(src);
          } catch {
            // ignore if not empty
          }
          continue;
        }
        // Dest exists and is a file: skip (shouldn't happen in practice)
        continue;
      }
      await fs.promises.rename(src, dest);
    }

    // Clean up empty nested directories left behind
    // Walk from skillMdDir up to targetDir, removing empty dirs
    let dir = skillMdDir;
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

  /**
   * Recursively find a directory that directly contains a file with the given name.
   */
  private findDirContaining(dir: string, fileName: string): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(dir, entry.name);
        if (fs.existsSync(path.join(subDir, fileName))) {
          return subDir;
        }
        // Recurse deeper
        const found = this.findDirContaining(subDir, fileName);
        if (found) return found;
      }
    } catch {
      // ignore read errors
    }
    return null;
  }

  /**
   * Scan the skills directory on disk and return all installed skills
   * that have a valid SKILL.md manifest. This does NOT require the Gateway
   * to be aware of the skill – it reads directly from the filesystem.
   */
  listInstalled(): Array<{
    slug: string;
    name: string;
    title?: string;
    version: string;
    source: string;
    baseDir: string;
    description?: string;
    author?: string;
  }> {
    const results: Array<{
      slug: string;
      name: string;
      title?: string;
      version: string;
      source: string;
      baseDir: string;
      description?: string;
      author?: string;
    }> = [];

    // Read lock.json for version/source/name/description/author metadata
    let lockSkills: Record<string, {
      version?: string;
      source?: string;
      name?: string;
      description?: string;
      author?: string;
    }> = {};
    try {
      const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
      if (fs.existsSync(lockFile)) {
        const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        lockSkills = (data.skills || {}) as typeof lockSkills;
      }
    } catch {
      // ignore
    }

    const seen = new Set<string>();
    const scanDir = (baseDir: string) => {
      if (!fs.existsSync(baseDir)) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (seen.has(entry.name)) continue;
        const skillDir = path.join(baseDir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) continue;
        seen.add(entry.name);

        const lockInfo = lockSkills[entry.name];
        // Include all skills with a valid SKILL.md manifest
        const name = lockInfo?.name || this.readSkillName(skillDir) || entry.name;
        const title = this.readSkillTitle(skillDir) || undefined;
        results.push({
          slug: entry.name,
          name,
          title,
          version: lockInfo?.version || this.readSkillMdVersion(skillDir) || 'unknown',
          source: lockInfo?.source || 'local',
          baseDir: skillDir,
          description: lockInfo?.description,
          author: lockInfo?.author,
        });
      }
    };

    scanDir(this.skillsDir);
    scanDir(this.getDisabledDir());

    return results;
  }

  /** Read version from SKILL.md YAML frontmatter. */
  readSkillMdVersion(skillDir: string): string | null {
    const fm = readSkillMdFrontmatter(skillDir);
    return fm?.version ?? null;
  }

  /**
   * Sync lock.json entries for installed skills missing from lock (idempotent, runs each startup).
   * Does not write server latest version — only local package metadata.
   */
  backfillLockVersions(): void {
    const lockDir = path.join(this.workDir, '.clawhub');
    const lockFile = path.join(lockDir, 'lock.json');

    const slugs = new Set<string>();
    const scanDir = (baseDir: string) => {
      if (!fs.existsSync(baseDir)) return;
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(baseDir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillMd)) slugs.add(entry.name);
      }
    };
    scanDir(this.skillsDir);
    scanDir(this.getDisabledDir());

    let lockSkills: Record<string, {
      version?: string;
      source?: string;
      versionSource?: string;
      name?: string;
      description?: string;
      author?: string;
      installedAt?: string;
    }> = {};
    if (fs.existsSync(lockFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        lockSkills = (data.skills || {}) as typeof lockSkills;
      } catch (err) {
        logger.warn('[StoSkillService] backfillLockVersions: failed to read lock.json:', err);
      }
    }

    for (const slug of slugs) {
      const skillDir = path.join(this.skillsDir, slug);
      const disabledDir = path.join(this.getDisabledDir(), slug);
      const dir = fs.existsSync(path.join(skillDir, 'SKILL.md')) ? skillDir : disabledDir;
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;

      if (fs.existsSync(path.join(dir, PREINSTALLED_MARKER_NAME))) continue;

      const lockInfo = lockSkills[slug];
      // 可靠安装记录：install 写入且版本非占位 1.0.0
      if (
        lockInfo?.source === 'sto-marketplace'
        && lockInfo.versionSource === 'install'
        && lockInfo.version
        && lockInfo.version !== '1.0.0'
      ) {
        continue;
      }

      const mdVersion = this.readSkillMdVersion(dir);
      const mdName = this.readSkillName(dir);
      const mdDescription = this.readSkillMdDescription(dir);
      const version = mdVersion || lockInfo?.version || '1.0.0';

      const normalizedTarget = normalizeSkillVersion(version);
      const normalizedLock = normalizeSkillVersion(lockInfo?.version);
      if (
        lockInfo?.source === 'sto-marketplace'
        && normalizedTarget
        && normalizedLock
        && normalizedTarget === normalizedLock
      ) {
        continue;
      }

      this.updateLockFile(slug, {
        version,
        name: lockInfo?.name || mdName || undefined,
        description: lockInfo?.description || mdDescription || undefined,
        author: lockInfo?.author,
        versionSource: mdVersion ? 'skill-md-backfill' : 'directory-scan',
      });
      logger.info(`[StoSkillService] backfillLockVersions: ${slug} -> ${version}`);
    }
  }

  /** Read description from SKILL.md YAML frontmatter. */
  readSkillMdDescription(skillDir: string): string | null {
    const fm = readSkillMdFrontmatter(skillDir);
    return fm?.description ?? null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Read the human-readable skill name from _meta.json or SKILL.md.
   * Priority: _meta.json slug → SKILL.md frontmatter name → SKILL.md H1 title
   */
  private readSkillName(skillDir: string): string | null {
    // 1. Try _meta.json (has slug like "national-day-countdown")
    try {
      const metaPath = path.join(skillDir, '_meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.name) return String(meta.name);
        if (meta.slug) return String(meta.slug);
      }
    } catch {
      // ignore
    }

    // 2. Try SKILL.md frontmatter: ---\nname: xxx\n---
    try {
      const fm = readSkillMdFrontmatter(skillDir);
      if (fm?.name) return fm.name;

      // 3. Fallback: first H1 heading
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
      const h1Match = raw.match(/^#\s+(.+)$/m);
      if (h1Match) return h1Match[1].trim();
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Read the human-readable skill title from SKILL.md frontmatter.
   * Priority: SKILL.md frontmatter title → null
   */
  private readSkillTitle(skillDir: string): string | null {
    try {
      const fm = readSkillMdFrontmatter(skillDir);
      if (fm?.title) return fm.title;
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Ensure SKILL.md has frontmatter with `name` and `description`.
   * Gateway (pi-coding-agent) skips skills without a description and falls
   * back to the directory name if `name` is missing. Since STO skills are
   * stored under a database-id directory (e.g. SKILL260401005), we inject
   * the human-readable metadata from the marketplace search results.
   *
   * Gateway requires name to match /^[a-z0-9-]+$/, so we use lowercase slug
   * as the skill identifier, while keeping the human-readable name as `title`.
   */
  private ensureSkillFrontmatter(
    skillDir: string,
    slug: string,
    meta: { name?: string; description?: string },
  ): void {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) return;

    // Generate a Gateway-compatible name from slug (lowercase)
    const gatewayName = slug.toLowerCase();

    try {
      const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
      const hasFrontmatter = /^---\s*\n/.test(raw);

      if (hasFrontmatter) {
        // Already has frontmatter – patch/override fields
        const endIdx = raw.indexOf('\n---', 3);
        if (endIdx === -1) return;

        const fmBlock = raw.substring(0, endIdx);
        const rest = raw.substring(endIdx);
        let patched = fmBlock;

        // Always override name with Gateway-compatible slug
        if (/^\s*name\s*:/m.test(fmBlock)) {
          patched = patched.replace(/^(\s*name\s*:\s*).*$/m, `$1${gatewayName}`);
        } else {
          patched += `\nname: ${gatewayName}`;
        }

        // Add title for human-readable display (if different from name)
        if (meta.name && meta.name !== gatewayName && !/^\s*title\s*:/m.test(patched)) {
          patched += `\ntitle: ${meta.name}`;
        }

        // Add description if missing
        if (meta.description && !/^\s*description\s*:/m.test(patched)) {
          patched += `\ndescription: ${meta.description}`;
        }

        if (patched !== fmBlock) {
          fs.writeFileSync(skillMdPath, patched + rest);
          logger.info(`[StoSkillService] patched frontmatter in ${skillMdPath}`);
        }
      } else if (meta.name || meta.description) {
        // No frontmatter at all – prepend one
        const lines: string[] = ['---'];
        lines.push(`name: ${gatewayName}`);
        if (meta.name && meta.name !== gatewayName) {
          lines.push(`title: ${meta.name}`);
        }
        if (meta.description) {
          lines.push(`description: ${meta.description}`);
        }
        lines.push('---');
        lines.push('');

        fs.writeFileSync(skillMdPath, lines.join('\n') + raw);
        logger.info(`[StoSkillService] injected frontmatter into ${skillMdPath}`);
      }
    } catch (err) {
      logger.warn('[StoSkillService] Failed to ensure frontmatter:', err);
    }
  }

  private updateLockFile(slug: string, meta: {
    version: string;
    name?: string;
    description?: string;
    author?: string;
    versionSource?: string;
  }): void {
    const lockDir = path.join(this.workDir, '.clawhub');
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
    const lockFile = path.join(lockDir, 'lock.json');

    let lockData: Record<string, unknown> = {};
    if (fs.existsSync(lockFile)) {
      try {
        lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch {
        lockData = {};
      }
    }

    if (!lockData.skills || typeof lockData.skills !== 'object') {
      lockData.skills = {};
    }
    const skillsMap = lockData.skills as Record<string, Record<string, unknown>>;
    const existing = skillsMap[slug] || {};
    skillsMap[slug] = {
      ...existing,
      version: meta.version,
      source: existing.source || 'sto-marketplace',
      name: meta.name ?? existing.name,
      description: meta.description ?? existing.description,
      author: meta.author ?? existing.author,
      versionSource: meta.versionSource ?? existing.versionSource ?? 'install',
      installedAt: (existing.installedAt as string | undefined) || new Date().toISOString(),
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
  }

  private updateUserLockFile(userCode: string, slug: string, meta: {
    version: string;
    name?: string;
    description?: string;
    author?: string;
    versionSource?: string;
  }): void {
    const lockDir = path.join(getOpenClawConfigDir(), 'users', userCode, '.clawhub');
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
    const lockFile = path.join(lockDir, 'lock.json');

    let lockData: Record<string, unknown> = {};
    if (fs.existsSync(lockFile)) {
      try {
        lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch {
        lockData = {};
      }
    }

    if (!lockData.skills || typeof lockData.skills !== 'object') {
      lockData.skills = {};
    }
    const skillsMap = lockData.skills as Record<string, Record<string, unknown>>;
    const existing = skillsMap[slug] || {};
    skillsMap[slug] = {
      ...existing,
      version: meta.version,
      source: existing.source || 'sto-marketplace',
      name: meta.name ?? existing.name,
      description: meta.description ?? existing.description,
      author: meta.author ?? existing.author,
      versionSource: meta.versionSource ?? existing.versionSource ?? 'install',
      installedAt: (existing.installedAt as string | undefined) || new Date().toISOString(),
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
  }
}
