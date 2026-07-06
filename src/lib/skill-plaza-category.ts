/**
 * Category helpers for the "My Skills" tab.
 * Uncategorized local skills fall back to 「其他」(qita) on the frontend only,
 * after plaza list / meta cache / local label resolution.
 */
import type { CategoryDef, PlazaSkillMeta, SkillSummary } from '@/types/skill-plaza';

export const MINE_FALLBACK_CATEGORY_CODE = 'qita';
export const MINE_FALLBACK_CATEGORY_LABEL = '其他';

function navCategorySlugs(categories: CategoryDef[]): Set<string> {
  return new Set(categories.map((c) => c.slug).filter(Boolean));
}

/** Map resolved slug into a visible nav bucket; unknown slugs fold into 「其他」. */
export function normalizeMineCategoryBucket(
  code: string | null,
  categories: CategoryDef[],
): string {
  const resolved = code ?? MINE_FALLBACK_CATEGORY_CODE;
  return navCategorySlugs(categories).has(resolved) ? resolved : MINE_FALLBACK_CATEGORY_CODE;
}

/** Resolve category slug without applying the qita fallback. */
export function resolveMineSkillCategoryCode(
  skill: SkillSummary,
  categories: CategoryDef[],
  metaMap: Record<string, PlazaSkillMeta>,
  plazaSkill?: SkillSummary,
): string | null {
  let code = skill.categoryCode || null;
  // Ignore backend/placeholder qita so plaza + meta cache can still enrich real categories.
  if (code === MINE_FALLBACK_CATEGORY_CODE) code = null;

  if (!code) {
    code = plazaSkill?.categoryCode || metaMap[skill.slug]?.categoryCode || null;
  }
  if (!code) {
    const label = plazaSkill?.category || metaMap[skill.slug]?.category || skill.category;
    if (label) {
      const cat = categories.find((c) => c.label === label);
      if (cat) code = cat.slug;
    }
  }
  return code;
}

export function resolveMineSkillCategoryLabel(
  skill: SkillSummary,
  categories: CategoryDef[],
  code: string,
): string {
  if (code === MINE_FALLBACK_CATEGORY_CODE) return MINE_FALLBACK_CATEGORY_LABEL;
  return categories.find((c) => c.slug === code)?.label || skill.category || MINE_FALLBACK_CATEGORY_LABEL;
}

/** Apply qita only when all resolution sources are exhausted. */
export function applyMineCategoryFallback(
  skill: SkillSummary,
  categories: CategoryDef[],
  metaMap: Record<string, PlazaSkillMeta>,
  plazaSkill?: SkillSummary,
): SkillSummary {
  const resolvedCode = resolveMineSkillCategoryCode(skill, categories, metaMap, plazaSkill);
  const categoryCode = normalizeMineCategoryBucket(resolvedCode, categories);
  const category = resolveMineSkillCategoryLabel(skill, categories, categoryCode);
  if (skill.categoryCode === categoryCode && skill.category === category) return skill;
  return { ...skill, categoryCode, category };
}

export function computeMineCategoryCounts(
  skills: SkillSummary[],
  categories: CategoryDef[],
  metaMap: Record<string, PlazaSkillMeta>,
  plazaSkills: SkillSummary[] = [],
): Record<string, number> {
  const plazaBySlug = new Map(plazaSkills.map((s) => [s.slug, s]));
  const counts: Record<string, number> = {};

  for (const skill of skills) {
    const resolved = resolveMineSkillCategoryCode(
      skill,
      categories,
      metaMap,
      plazaBySlug.get(skill.slug),
    );
    const code = normalizeMineCategoryBucket(resolved, categories);
    counts[code] = (counts[code] || 0) + 1;
  }

  // 「全部」= 当前 Tab 下技能总数（含导航未展示分类的技能）
  counts[''] = skills.length;

  return counts;
}
