/**
 * STO Skill Service
 * Manages downloading and installing skills from the STO AI Memory Center backend.
 * Mirrors the ClawHubService interface for consistency.
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

import { getOpenClawConfigDir, getOpenClawSkillsDir, getOpenClawAgentSkillsDir } from '../utils/paths';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  constructor() {
    this.workDir = getOpenClawConfigDir();
    this.skillsDir = getOpenClawSkillsDir();
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
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
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const headers = buildStoMemoryCenterAuthHeaders(token);
    const url = `${baseUrl}/agent/v1/skills/slug/${encodeURIComponent(params.slug)}/download?network=external`;
    logger.info(`[StoSkillService] install: downloading ${url}`);

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 技能下载失败 (${res.status}): ${text}`);
    }

    // Determine install directory: agent-scoped or global
    const skillsDir = params.agentId
      ? getOpenClawAgentSkillsDir(params.agentId)
      : this.skillsDir;
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    // Save to a temp file
    const tmpZipPath = path.join(this.workDir, `.tmp-sto-skill-${params.slug}-${Date.now()}.zip`);
    try {
      const body = res.body;
      if (!body) throw new Error('下载响应没有 body');

      // Node 18+ fetch body is a ReadableStream; pipe to disk
      const fileStream = createWriteStream(tmpZipPath);
      // @ts-expect-error Node fetch body is compatible with Readable
      await pipeline(body, fileStream);

      // Extract ZIP
      const targetDir = path.join(skillsDir, params.slug);
      if (params.force && fs.existsSync(targetDir)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
      }
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      await this.extractZip(tmpZipPath, targetDir);

      // Ensure SKILL.md has proper frontmatter so Gateway can load it.
      // Gateway requires at least a `description` in frontmatter, and uses
      // `name` to identify the skill (falls back to directory name otherwise).
      // Gateway requires name to match /^[a-z0-9-]+$/, so we use lowercase slug.
      this.ensureSkillFrontmatter(targetDir, params.slug, {
        name: params.name,
        description: params.description,
      });

      // Update lock.json with metadata from search results
      this.updateLockFile(params.slug, {
        version: params.version || '1.0.0',
        name: params.name,
        description: params.description,
        author: params.author,
      });

      logger.info(`[StoSkillService] install: ${params.slug} installed to ${targetDir}`);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tmpZipPath)) {
        fs.unlinkSync(tmpZipPath);
      }
    }
  }

  /**
   * Uninstall a skill (same as ClawHub: delete dir + update lock).
   */
  async uninstall(params: StoSkillUninstallParams): Promise<void> {
    const skillsDir = params.agentId
      ? getOpenClawAgentSkillsDir(params.agentId)
      : this.skillsDir;
    const skillDir = path.join(skillsDir, params.slug);
    if (fs.existsSync(skillDir)) {
      logger.info(`[StoSkillService] uninstall: removing ${skillDir}`);
      await fs.promises.rm(skillDir, { recursive: true, force: true });
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
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async extractZip(zipPath: string, targetDir: string): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const isWin = process.platform === 'win32';
    if (isWin) {
      await execAsync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`,
      );
    } else {
      await execAsync(`unzip -o "${zipPath}" -d "${targetDir}"`);
    }

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

    // Move all contents from the found directory up to targetDir
    const entries = fs.readdirSync(skillMdDir);
    for (const name of entries) {
      const src = path.join(skillMdDir, name);
      const dest = path.join(targetDir, name);
      // If dest already exists (e.g. the nested parent dir itself), skip
      if (fs.existsSync(dest)) continue;
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
    version: string;
    source: string;
    baseDir: string;
    description?: string;
    author?: string;
  }> {
    const results: Array<{
      slug: string;
      name: string;
      version: string;
      source: string;
      baseDir: string;
      description?: string;
      author?: string;
    }> = [];
    if (!fs.existsSync(this.skillsDir)) return results;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      return results;
    }

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

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(this.skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const lockInfo = lockSkills[entry.name];
      // Only include STO-marketplace sourced skills
      if (lockInfo?.source === 'sto-marketplace') {
        // Prefer name from lock.json (saved from search results), fallback to file scan
        const name = lockInfo.name || this.readSkillName(skillDir) || entry.name;
        results.push({
          slug: entry.name,
          name,
          version: lockInfo.version || 'unknown',
          source: 'sto-marketplace',
          baseDir: skillDir,
          description: lockInfo.description,
          author: lockInfo.author,
        });
      }
    }

    return results;
  }

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
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const raw = fs.readFileSync(skillMdPath, 'utf8');

      const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const nameMatch = frontmatterMatch[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
        if (nameMatch) return nameMatch[1].trim();
      }

      // 3. Fallback: first H1 heading
      const h1Match = raw.match(/^#\s+(.+)$/m);
      if (h1Match) return h1Match[1].trim();
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
      const raw = fs.readFileSync(skillMdPath, 'utf8');
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
    (lockData.skills as Record<string, unknown>)[slug] = {
      version: meta.version,
      source: 'sto-marketplace',
      name: meta.name,
      description: meta.description,
      author: meta.author,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
  }
}
