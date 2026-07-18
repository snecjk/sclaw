/**
 * STO Skill Service (facade)
 * Delegates lifecycle operations to SkillManager while preserving the public API.
 */
import fs from 'fs';
import path from 'path';
import { getOpenClawConfigDir, getOpenClawSkillsDir } from '../utils/paths';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { normalizeSkillVersion } from '../utils/skill-version';
import {
  getSkillManager,
  PREINSTALLED_MARKER_NAME,
  USER_UPLOAD_MARKER_NAME,
} from './skills/skill-manager';
import {
  readSkillMdDescription,
  readSkillMdVersion,
  readSkillName,
  readSkillTitle,
} from './skills/skill-package';

export { PREINSTALLED_MARKER_NAME, USER_UPLOAD_MARKER_NAME };

export interface StoSkillSearchParams {
  query?: string;
  limit?: number;
}

export interface StoSkillInstallParams {
  slug: string;
  version?: string;
  force?: boolean;
  name?: string;
  description?: string;
  author?: string;
  agentId?: string;
}

export interface StoSkillUninstallParams {
  slug: string;
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

  private getDisabledDir(): string {
    return path.join(this.workDir, 'skills-disabled');
  }

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
    const res = await fetch(url, { method: 'GET', headers });
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

  async install(params: StoSkillInstallParams): Promise<void> {
    await getSkillManager().install(params);
  }

  async uploadSkill(filePath: string): Promise<{ slug: string }> {
    return getSkillManager().uploadSkill(filePath);
  }

  async uninstall(params: StoSkillUninstallParams): Promise<void> {
    await getSkillManager().uninstall(params);
  }

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

        const name = this.readSkillName(skillDir) || entry.name;
        const title = this.readSkillTitle(skillDir) || undefined;
        const lockFallback = this.readLockSync(entry.name);
        results.push({
          slug: entry.name,
          name: lockFallback?.name || name,
          title,
          version: lockFallback?.version || this.readSkillMdVersion(skillDir) || 'unknown',
          source: lockFallback?.source || 'local',
          baseDir: skillDir,
          description: lockFallback?.description,
          author: lockFallback?.author,
        });
      }
    };

    scanDir(this.skillsDir);
    scanDir(this.getDisabledDir());

    return results;
  }

  private readLockSync(slug: string): {
    version?: string;
    source?: string;
    name?: string;
    description?: string;
    author?: string;
  } | null {
    try {
      const lockFile = path.join(this.workDir, '.clawhub', 'lock.json');
      if (!fs.existsSync(lockFile)) return null;
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
        skills?: Record<string, {
          version?: string;
          source?: string;
          name?: string;
          description?: string;
          author?: string;
        }>;
      };
      return data.skills?.[slug] || null;
    } catch {
      return null;
    }
  }

  readSkillMdVersion(skillDir: string): string | null {
    return readSkillMdVersion(skillDir);
  }

  backfillLockVersions(): void {
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

    for (const slug of slugs) {
      const skillDir = path.join(this.skillsDir, slug);
      const disabledDir = path.join(this.getDisabledDir(), slug);
      const dir = fs.existsSync(path.join(skillDir, 'SKILL.md')) ? skillDir : disabledDir;
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
      if (fs.existsSync(path.join(dir, PREINSTALLED_MARKER_NAME))) continue;

      const lockInfo = this.readLockSync(slug);
      if (
        lockInfo?.source === 'sto-marketplace'
        && lockInfo.version
        && lockInfo.version !== '1.0.0'
      ) {
        continue;
      }

      const mdVersion = this.readSkillMdVersion(dir);
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

      void (async () => {
        try {
          const { upsertSkillEntry } = await import('./skills/canonical-store');
          const { getCurrentActiveUserCode } = await import('./user-skill-workspace');
          const userCode = await getCurrentActiveUserCode();
          await upsertSkillEntry({
            slug,
            scope: userCode ? 'user' : 'global',
            userCode: userCode || undefined,
            version,
            source: lockInfo?.source || 'sto-marketplace',
            name: lockInfo?.name || this.readSkillName(dir) || undefined,
            description: lockInfo?.description || this.readSkillMdDescription(dir) || undefined,
            author: lockInfo?.author,
            enabled: fs.existsSync(skillDir),
            versionSource: mdVersion ? 'skill-md-backfill' : 'directory-scan',
          });
        } catch (err) {
          logger.warn('[StoSkillService] backfillLockVersions canonical update failed:', err);
        }
      })();
    }
  }

  readSkillMdDescription(skillDir: string): string | null {
    return readSkillMdDescription(skillDir);
  }

  private readSkillName(skillDir: string): string | null {
    return readSkillName(skillDir);
  }

  private readSkillTitle(skillDir: string): string | null {
    return readSkillTitle(skillDir);
  }
}
