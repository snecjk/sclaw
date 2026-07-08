/**
 * 将技能的展示分类与 Apollo 可见的导航分类对齐。
 * 优先使用广场接口返回的 `category_codes` / `category_names`，而非单一的 `category_code`。
 */
export interface SkillCategorySource {
  categoryCode?: string | null;
  category?: string | null;
  categoryCodes?: string[] | null;
  categoryNames?: string[] | null;
}

export interface NavCategoryPick {
  slug: string;
  label: string;
}

export function pickNavCategoryFromApiSkill(
  skill: SkillCategorySource,
  navCategories: NavCategoryPick[],
): { code: string | null; label: string | null } {
  const navSlugs = new Set(navCategories.map((c) => c.slug).filter(Boolean));
  const codes = (skill.categoryCodes ?? []).filter((c) => Boolean(c && String(c).trim()));
  const names = skill.categoryNames ?? [];

  for (let i = 0; i < codes.length; i++) {
    const code = String(codes[i]);
    if (navSlugs.has(code)) {
      const label =
        names[i]
        || navCategories.find((c) => c.slug === code)?.label
        || skill.category
        || null;
      return { code, label };
    }
  }

  const primary = skill.categoryCode || null;
  if (primary && navSlugs.has(primary)) {
    return {
      code: primary,
      label: skill.category ?? navCategories.find((c) => c.slug === primary)?.label ?? null,
    };
  }

  return { code: null, label: null };
}
