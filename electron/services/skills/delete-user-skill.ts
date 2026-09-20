import fs from 'node:fs';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { readPreinstalledManifestSlugs } from '../../utils/skill-config';
import { safeRemoveDir } from '../../utils/fs-retry';
import { getSkillEntry, removeSkillEntry, resolvePackageDir } from './canonical-store';
import { getSkillManager } from './skill-manager';

export class DeleteUserSkillError extends Error {
  constructor(readonly code: 'NOT_LOGGED_IN' | 'INVALID_SLUG' | 'PREINSTALL_PROTECTED' | 'SKILL_NOT_FOUND', message: string) {
    super(message);
  }
}

export async function deleteUserSkill(input: { slug: string }) {
  const userCode = await getCurrentActiveUserCode();
  if (!userCode) throw new DeleteUserSkillError('NOT_LOGGED_IN', '未登录，无法删除用户技能');
  // Never normalize a destructive target into a different valid identifier.
  const slug = input?.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new DeleteUserSkillError('INVALID_SLUG', '必须提供准确的技能 slug，不能使用名称或路径');
  }
  if (readPreinstalledManifestSlugs().has(slug)) {
    throw new DeleteUserSkillError('PREINSTALL_PROTECTED', '不能删除系统预装技能');
  }
  const key = { slug, scope: 'user' as const, userCode };
  const dir = resolvePackageDir(key);
  if (!await getSkillEntry(key) && !fs.existsSync(dir)) {
    throw new DeleteUserSkillError('SKILL_NOT_FOUND', '当前用户不存在此技能');
  }
  if (fs.existsSync(dir)) await safeRemoveDir(dir, { label: dir });
  await removeSkillEntry(key);
  // Reconcile rather than plaza uninstall: shared/global copies must survive.
  await getSkillManager().reconcile({ userCode });
  return { ok: true as const, slug, scope: 'user' as const, userCode };
}
