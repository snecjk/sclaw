/**
 * Category helpers for the "My Skills" tab.
 * Uncategorized local skills fall back to 「其他」(qita) on the frontend only,
 * after plaza list / meta cache / local label resolution.
 */
import type { CategoryDef, PlazaSkillMeta, SkillSummary } from '@/types/skill-plaza';
import { pickNavCategoryFromApiSkill } from '../../shared/skill-plaza-category-resolve';

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

function mergeCategorySource(
  skill: SkillSummary,
  metaMap: Record<string, PlazaSkillMeta>,
  plazaSkill?: SkillSummary,
): {
  categoryCode?: string | null;
  category?: string | null;
  categoryCodes?: string[];
  categoryNames?: string[];
} {
  const meta = metaMap[skill.slug];
  return {
    categoryCode: skill.categoryCode ?? plazaSkill?.categoryCode ?? meta?.categoryCode ?? null,
    category: skill.category ?? plazaSkill?.category ?? meta?.category ?? null,
    categoryCodes: skill.categoryCodes ?? plazaSkill?.categoryCodes ?? meta?.categoryCodes,
    categoryNames: skill.categoryNames ?? plazaSkill?.categoryNames ?? meta?.categoryNames,
  };
}

/** Resolve category slug without applying the qita fallback. */
export function resolveMineSkillCategoryCode(
  skill: SkillSummary,
  categories: CategoryDef[],
  metaMap: Record<string, PlazaSkillMeta>,
  plazaSkill?: SkillSummary,
): string | null {
  const merged = mergeCategorySource(skill, metaMap, plazaSkill);
  const picked = pickNavCategoryFromApiSkill(merged, categories);
  if (picked.code) return picked.code;

  if (merged.categoryCode === MINE_FALLBACK_CATEGORY_CODE) return null;

  if (merged.category) {
    const cat = categories.find((c) => c.label === merged.category);
    if (cat) return cat.slug;
  }
  return null;
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
  const navSlugs = navCategorySlugs(categories);
  if (skill.categoryCode && navSlugs.has(skill.categoryCode)) {
    const category = resolveMineSkillCategoryLabel(skill, categories, skill.categoryCode);
    if (skill.category === category) return skill;
    return { ...skill, categoryCode: skill.categoryCode, category };
  }

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

  counts[''] = skills.length;

  return counts;
}
