import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesiredSkillPackage } from './canonical-store';

const packageHashCache = new Map<string, { signature: string; hash: string }>();

export async function computeSkillPackageHash(pkg: DesiredSkillPackage): Promise<string> {
  const skillPath = join(pkg.sourceDir, 'SKILL.md');
  let skillMd = '';
  let fileSignature = 'missing';
  try {
    const info = await stat(skillPath);
    fileSignature = `${info.size}:${info.mtimeMs}`;
  } catch {
    // Missing packages are ignored by engine projections and rejected by runtime loading.
  }
  const signature = `${pkg.slug}\n${pkg.version}\n${pkg.scope}\n${pkg.enabled}\n${fileSignature}`;
  const cached = packageHashCache.get(skillPath);
  if (cached?.signature === signature) return cached.hash;
  if (fileSignature !== 'missing') {
    skillMd = await readFile(skillPath, 'utf-8').catch(() => '');
  }
  const hash = createHash('sha256').update(`${signature}\n${skillMd}`).digest('hex');
  packageHashCache.set(skillPath, { signature, hash });
  return hash;
}
