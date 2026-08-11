/**
 * Display-name sort for「我的技能」and composer skill pickers.
 *
 * Groups (in order): Chinese → Latin (A–Z) → digits/symbols/other.
 * Within a group: localeCompare('zh-CN') so Chinese follows pinyin order.
 */

export type SkillDisplayNameSortGroup = 'chinese' | 'latin' | 'other';

const GROUP_RANK: Record<SkillDisplayNameSortGroup, number> = {
  chinese: 0,
  latin: 1,
  other: 2,
};

function isCjkIdeograph(codePoint: number): boolean {
  return (
    (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
  );
}

/** First non-whitespace character decides the group. */
export function getSkillDisplayNameSortGroup(title: string): SkillDisplayNameSortGroup {
  const trimmed = title.trim();
  if (!trimmed) return 'other';
  const code = trimmed.codePointAt(0) ?? 0;
  if (isCjkIdeograph(code)) return 'chinese';
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return 'latin';
  return 'other';
}

export function compareSkillDisplayNames(leftTitle: string, rightTitle: string): number {
  const leftGroup = getSkillDisplayNameSortGroup(leftTitle);
  const rightGroup = getSkillDisplayNameSortGroup(rightTitle);
  if (leftGroup !== rightGroup) {
    return GROUP_RANK[leftGroup] - GROUP_RANK[rightGroup];
  }
  return leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
}

export function sortSkillsByDisplayName<T extends { title: string; slug?: string }>(skills: T[]): T[] {
  return [...skills].sort((left, right) => {
    const byTitle = compareSkillDisplayNames(left.title ?? '', right.title ?? '');
    if (byTitle !== 0) return byTitle;
    return (left.slug ?? '').localeCompare(right.slug ?? '', 'en');
  });
}
