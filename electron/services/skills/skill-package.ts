/**
 * Engine-agnostic skill package helpers: download, extract, hoist, frontmatter.
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { getOpenClawConfigDir } from '../../utils/paths';
import { getStoToken } from '../../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { TIMEOUTS } from '../../utils/config';
import { readSkillMdFrontmatter } from '../../utils/skill-frontmatter';
import { safeRemoveDir } from '../../utils/fs-retry';

export async function downloadSkillZipToFile(slug: string, destZipPath: string): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const token = await getStoToken();
  if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

  const headers = buildStoMemoryCenterAuthHeaders(token);
  const url = `${baseUrl}/agent/v1/skills/slug/${encodeURIComponent(slug)}/download?network=external`;
  const res = await proxyAwareFetch(url, {
    method: 'GET',
    headers,
    timeoutMs: TIMEOUTS.SKILL_INSTALL,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`STO 技能下载失败 (${res.status}): ${text}`);
  }

  const body = res.body;
  if (!body) throw new Error('下载响应没有 body');
  const fileStream = createWriteStream(destZipPath);
  await pipeline(body, fileStream);
}

export async function extractZip(zipPath: string, targetDir: string): Promise<void> {
  const { extractZip: unifiedExtractZip } = await import('../../utils/zip-extract');
  await unifiedExtractZip(zipPath, targetDir);
  await hoistSkillContent(targetDir);
}

export async function hoistSkillContent(targetDir: string): Promise<void> {
  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) return;

  const skillMdDir = findDirContaining(targetDir, 'SKILL.md');
  if (!skillMdDir) {
    logger.warn(`[skill-package] SKILL.md not found in ${targetDir}, skipping hoist`);
    return;
  }

  const entries = fs.readdirSync(skillMdDir);
  for (const name of entries) {
    const src = path.join(skillMdDir, name);
    const dest = path.join(targetDir, name);
    if (fs.existsSync(dest)) {
      if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
        const subEntries = fs.readdirSync(src);
        for (const subName of subEntries) {
          const subSrc = path.join(src, subName);
          const subDest = path.join(dest, subName);
          if (!fs.existsSync(subDest)) {
            await fs.promises.rename(subSrc, subDest);
          }
        }
        try {
          fs.rmdirSync(src);
        } catch {
          // ignore if not empty
        }
        continue;
      }
      continue;
    }
    await fs.promises.rename(src, dest);
  }

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

function findDirContaining(dir: string, fileName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(dir, entry.name);
      if (fs.existsSync(path.join(subDir, fileName))) {
        return subDir;
      }
      const found = findDirContaining(subDir, fileName);
      if (found) return found;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Ensure SKILL.md has Gateway-compatible frontmatter (`name` = lowercase slug).
 */
export function ensureSkillFrontmatter(
  skillDir: string,
  slug: string,
  meta: { name?: string; description?: string },
): void {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return;

  const gatewayName = slug.toLowerCase();

  try {
    const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
    const hasFrontmatter = /^---\s*\n/.test(raw);

    if (hasFrontmatter) {
      const endIdx = raw.indexOf('\n---', 3);
      if (endIdx === -1) return;

      const fmBlock = raw.substring(0, endIdx);
      const rest = raw.substring(endIdx);
      let patched = fmBlock;

      if (/^\s*name\s*:/m.test(fmBlock)) {
        patched = patched.replace(/^(\s*name\s*:\s*).*$/m, `$1${gatewayName}`);
      } else {
        patched += `\nname: ${gatewayName}`;
      }

      if (meta.name && meta.name !== gatewayName && !/^\s*title\s*:/m.test(patched)) {
        patched += `\ntitle: ${meta.name}`;
      }

      if (meta.description && !/^\s*description\s*:/m.test(patched)) {
        patched += `\ndescription: ${meta.description}`;
      }

      if (patched !== fmBlock) {
        fs.writeFileSync(skillMdPath, patched + rest);
      }
    } else if (meta.name || meta.description) {
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
    }
  } catch (err) {
    logger.warn('[skill-package] Failed to ensure frontmatter:', err);
  }
}

export async function promoteStagedSkillDir(
  stagingDir: string,
  targetDir: string,
  force: boolean,
): Promise<void> {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  if (!force && fs.existsSync(targetDir)) {
    await copyDir(stagingDir, targetDir);
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

export async function copyDir(src: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

export function createTempSkillPaths(slug: string): { zipPath: string; stagingDir: string } {
  const workDir = getOpenClawConfigDir();
  const stamp = Date.now();
  return {
    zipPath: path.join(workDir, `.tmp-sto-skill-${slug}-${stamp}.zip`),
    stagingDir: path.join(workDir, `.tmp-sto-skill-staging-${slug}-${stamp}`),
  };
}

export function readSkillName(skillDir: string): string | null {
  try {
    const metaPath = path.join(skillDir, '_meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { name?: string; slug?: string };
      if (meta.name) return String(meta.name);
      if (meta.slug) return String(meta.slug);
    }
  } catch {
    // ignore
  }

  try {
    const fm = readSkillMdFrontmatter(skillDir);
    if (fm?.name) return fm.name;
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
    const h1Match = raw.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();
  } catch {
    // ignore
  }
  return null;
}

export function readSkillTitle(skillDir: string): string | null {
  try {
    const fm = readSkillMdFrontmatter(skillDir);
    if (fm?.title) return fm.title;
  } catch {
    // ignore
  }
  return null;
}

export function readSkillMdVersion(skillDir: string): string | null {
  const fm = readSkillMdFrontmatter(skillDir);
  return fm?.version ?? null;
}

export function readSkillMdDescription(skillDir: string): string | null {
  const fm = readSkillMdFrontmatter(skillDir);
  return fm?.description ?? null;
}

export function validateSkillPackage(stagingDir: string): void {
  if (fs.existsSync(path.join(stagingDir, 'SKILL.md'))) return;
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  const hasNestedSkill = entries.some(
    (e) => e.isDirectory() && fs.existsSync(path.join(stagingDir, e.name, 'SKILL.md')),
  );
  if (!hasNestedSkill) {
    throw new Error('未找到 SKILL.md，请确认压缩包或文件夹结构正确');
  }
}

export function resolveSkillDirFromStaging(stagingDir: string): string {
  if (fs.existsSync(path.join(stagingDir, 'SKILL.md'))) {
    return stagingDir;
  }
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  const nested = entries.find(
    (e) => e.isDirectory() && fs.existsSync(path.join(stagingDir, e.name, 'SKILL.md')),
  );
  if (nested) {
    return path.join(stagingDir, nested.name);
  }
  throw new Error('未找到 SKILL.md，请确认压缩包或文件夹结构正确');
}

export function slugFromFrontmatterName(rawName: string): string {
  const slug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) {
    throw new Error(`从 SKILL.md name 字段解析 slug 失败: ${rawName}`);
  }
  return slug;
}
