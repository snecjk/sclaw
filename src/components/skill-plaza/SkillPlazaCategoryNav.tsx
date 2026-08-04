import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { cn } from '@/lib/utils';
import { computeMineCategoryCounts } from '@/lib/skill-plaza-category';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const ALL_CATEGORY_SLUG = '';

function isAllCategory(slug: string, label: string): boolean {
  const normalizedLabel = label.trim().toLowerCase();
  return (
    slug.trim() === ALL_CATEGORY_SLUG ||
    slug.trim().toLowerCase() === 'all' ||
    normalizedLabel === '全部' ||
    normalizedLabel === 'all' ||
    normalizedLabel === 'すべて'
  );
}

export function SkillPlazaCategoryNav() {
  const { t } = useTranslation('skills');
  const { categories, categoryCounts, activeCategory, setActiveCategory, activeTab, mySkills, searchQuery, plazaSkillMetaMap, plazaSkills, total } = useSkillPlazaStore();

  // Plaza tab: trust backend categoryCounts (computed from the full search scope).
  // Mine tab: derive counts from the enriched local list so UI stays in sync with search.
  const { displayCounts, allCount } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filteredMineSkills = query
      ? mySkills.filter((s) =>
          s.title.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
        )
      : mySkills;

    if (activeTab !== 'mine') {
      const countedCategories = categories.filter((cat) => !isAllCategory(cat.slug, cat.label));
      const hasCategoryCounts = countedCategories.some((cat) => categoryCounts[cat.slug] !== undefined);
      const categoryCountTotal = countedCategories.reduce(
        (sum, cat) => sum + (categoryCounts[cat.slug] ?? 0),
        0,
      );
      return {
        displayCounts: categoryCounts,
        allCount: hasCategoryCounts
          ? categoryCountTotal
          : total ?? categoryCounts[ALL_CATEGORY_SLUG] ?? plazaSkills.length,
      };
    }

    return {
      displayCounts: computeMineCategoryCounts(filteredMineSkills, categories, plazaSkillMetaMap, plazaSkills),
      allCount: filteredMineSkills.length,
    };
  }, [activeTab, categoryCounts, mySkills, searchQuery, categories, plazaSkillMetaMap, plazaSkills, total]);

  const categoryItems = useMemo(() => {
    const allCategory = {
      slug: ALL_CATEGORY_SLUG,
      label: t('skillPlaza.category.all', { defaultValue: '全部' }),
    };
    return [
      allCategory,
      ...categories.filter((cat) => !isAllCategory(cat.slug, cat.label)),
    ];
  }, [categories, t]);

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 my-2.5 mx-0 p-0" aria-label="技能分类">
      {categoryItems.map((cat) => (
        <button
          key={cat.slug || 'all'}
          onClick={() => setActiveCategory(cat.slug)}
          className={cn(
            'inline-flex items-center gap-0.5 px-3 py-1.5 border-none rounded-lg bg-transparent text-sm font-medium whitespace-nowrap cursor-pointer transition-colors',
            activeCategory === cat.slug
              ? 'bg-[#e5e7eb] text-[#111827] font-semibold'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span>{cat.label}</span>
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              activeCategory === cat.slug ? 'text-muted-foreground' : 'text-muted-foreground/60',
            )}
          >
            {cat.slug === ALL_CATEGORY_SLUG ? allCount : displayCounts[cat.slug] ?? 0}
          </span>
        </button>
      ))}
    </nav>
  );
}
