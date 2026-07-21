/**
 * Persist agent-created skills into skills-store user scope.
 * Shared by Host API, Claude MCP, and (via HTTP) OpenClaw plugins.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSkillFrontmatter } from '../../utils/skill-frontmatter';
import { readPreinstalledManifestSlugs } from '../../utils/skill-config';
import { getSkillsStoreUserSkillsDir } from '../../utils/paths';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { getSkillEntry, resolvePackageDir } from './canonical-store';
import { ensureSkillFrontmatter, slugFromFrontmatterName } from './skill-package';
import { getSkillManager } from './skill-manager';
import { scheduleOrphanSkillImport } from './orphan-skill-import';

export type SaveUserSkillErrorCode =
  | 'NOT_LOGGED_IN'
  | 'INVALID_SLUG'
  | 'INVALID_SKILL_MD'
  | 'PREINSTALL_PROTECTED'
  | 'ALREADY_EXISTS'
  | 'WRITE_FAILED';

export class SaveUserSkillError extends Error {
  readonly code: SaveUserSkillErrorCode;

  constructor(code: SaveUserSkillErrorCode, message: string) {
    super(message);
    this.name = 'SaveUserSkillError';
    this.code = code;
  }
}

export type SaveUserSkillAsset = {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
};

export type SaveUserSkillInput = {
  slug?: string;
  skillMd: string;
  name?: string;
  description?: string;
  assets?: SaveUserSkillAsset[];
  /** Default true: overwrite existing user-scoped package. */
  force?: boolean;
};

export type SaveUserSkillResult = {
  ok: true;
  slug: string;
  scope: 'user';
  userCode: string;
  storePath: string;
  source: 'local';
};

export function normalizeSkillSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SaveUserSkillError('INVALID_SLUG', `非法技能 slug: ${raw}`);
  }
  return slug;
}

function parseSkillMdMeta(skillMd: string): { name: string; description: string; version?: string } {
  const normalized = skillMd.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    throw new SaveUserSkillError('INVALID_SKILL_MD', 'SKILL.md 缺少 YAML frontmatter');
  }
  const meta = parseSkillFrontmatter(match[1]);
  const name = meta.name?.trim();
  const description = meta.description?.trim();
  if (!name) {
    throw new SaveUserSkillError('INVALID_SKILL_MD', 'SKILL.md frontmatter 缺少 name');
  }
  if (!description) {
    throw new SaveUserSkillError('INVALID_SKILL_MD', 'SKILL.md frontmatter 缺少 description');
  }
  return {
    name,
    description,
    version: meta.version?.trim() || undefined,
  };
}

function assertSafeAssetPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(relPath)) {
    throw new SaveUserSkillError('WRITE_FAILED', `非法资产路径: ${relPath}`);
  }
  return normalized;
}

async function writeStagingDir(
  slug: string,
  skillMd: string,
  assets: SaveUserSkillAsset[] | undefined,
  meta: { name?: string; description?: string },
): Promise<string> {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `stoclaw-save-skill-${slug}-`));
  try {
    fs.writeFileSync(path.join(stagingDir, 'SKILL.md'), skillMd.replace(/\r\n/g, '\n'), 'utf8');
    ensureSkillFrontmatter(stagingDir, slug, {
      name: meta.name,
      description: meta.description,
    });

    for (const asset of assets || []) {
      const rel = assertSafeAssetPath(asset.path);
      const target = path.join(stagingDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (asset.encoding === 'base64') {
        fs.writeFileSync(target, Buffer.from(asset.content, 'base64'));
      } else {
        fs.writeFileSync(target, asset.content, 'utf8');
      }
    }
    return stagingDir;
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Save an agent-authored skill into skills-store users/{userCode}/skills/{slug}.
 */
export async function saveUserSkill(input: SaveUserSkillInput): Promise<SaveUserSkillResult> {
  const userCode = await getCurrentActiveUserCode();
  if (!userCode) {
    throw new SaveUserSkillError('NOT_LOGGED_IN', '未登录，无法保存用户技能');
  }

  if (!input.skillMd?.trim()) {
    throw new SaveUserSkillError('INVALID_SKILL_MD', 'skillMd 不能为空');
  }

  const parsed = parseSkillMdMeta(input.skillMd);
  let slug: string;
  try {
    const rawSlug = input.slug?.trim() || slugFromFrontmatterName(input.name?.trim() || parsed.name);
    slug = normalizeSkillSlug(rawSlug);
  } catch (error) {
    if (error instanceof SaveUserSkillError) throw error;
    throw new SaveUserSkillError(
      'INVALID_SLUG',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (readPreinstalledManifestSlugs().has(slug)) {
    throw new SaveUserSkillError(
      'PREINSTALL_PROTECTED',
      `技能 ${slug} 属于系统预装白名单，不能通过会话工具覆盖`,
    );
  }

  const force = input.force !== false;
  const userKey = { slug, scope: 'user' as const, userCode };
  const existingEntry = await getSkillEntry(userKey);
  const existingDir = resolvePackageDir(userKey);
  const alreadyPresent = Boolean(existingEntry) || fs.existsSync(path.join(existingDir, 'SKILL.md'));
  if (alreadyPresent && !force) {
    throw new SaveUserSkillError('ALREADY_EXISTS', `用户技能 ${slug} 已存在`);
  }

  const displayName = input.name?.trim() || parsed.name;
  const description = input.description?.trim() || parsed.description;
  const version = parsed.version || '1.0.0';

  let stagingDir: string | null = null;
  try {
    stagingDir = await writeStagingDir(slug, input.skillMd, input.assets, {
      name: displayName,
      description,
    });

    await getSkillManager().installFromLocalDir({
      slug,
      sourceDir: stagingDir,
      version,
      source: 'local',
      enabled: true,
      scope: 'user',
      name: displayName,
      description,
    });

    const storePath = path.join(getSkillsStoreUserSkillsDir(userCode), slug);
    // Soft schedule: pick up any parallel unmanaged writes without blocking.
    scheduleOrphanSkillImport('after-save-user-skill');

    return {
      ok: true,
      slug,
      scope: 'user',
      userCode,
      storePath,
      source: 'local',
    };
  } catch (error) {
    if (error instanceof SaveUserSkillError) throw error;
    throw new SaveUserSkillError(
      'WRITE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (stagingDir && fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}
