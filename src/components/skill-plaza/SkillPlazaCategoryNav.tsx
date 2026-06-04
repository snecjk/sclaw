import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

export function SkillPlazaCategoryNav() {
  const { categories, categoryCounts, activeCategory, setActiveCategory, activeTab, mySkills, plazaSkills, searchQuery, plazaSkillMetaMap } = useSkillPlazaStore();

  // Recompute counts from the actually displayed skills when search is active,
  // because backend categoryCounts may reflect the full unfiltered set.
  const displayCounts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // Determine the skill list that is actually being displayed
    const sourceSkills = activeTab === 'mine' ? mySkills : plazaSkills;
    const filtered = query
      ? sourceSkills.filter((s) =>
          s.title.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
        )
      : sourceSkills;

    // When no search query, use backend counts for 'all' tab to preserve accuracy
    if (!query && activeTab !== 'mine') return categoryCounts;

    const counts: Record<string, number> = {};
    // Total count under empty string key (matching backend convention)
    counts[''] = filtered.length;

    for (const skill of filtered) {
      // Prefer skill.categoryCode; fallback to plaza meta cache for accurate categorization
      let code = skill.categoryCode;
      if (!code) {
        const meta = plazaSkillMetaMap[skill.slug];
        if (meta) {
          code = meta.categoryCode;
          if (!code && meta.category) {
            const cat = categories.find((c) => c.label === meta.category);
            if (cat) code = cat.slug;
          }
        }
      }
      if (code) {
        counts[code] = (counts[code] || 0) + 1;
      }
    }

    return counts;
  }, [activeTab, categoryCounts, mySkills, plazaSkills, searchQuery, plazaSkillMetaMap, categories]);

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 my-2.5 mx-0 p-0" aria-label="技能分类">
      {categories.map((cat) => (
        <button
          key={cat.slug}
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
            {displayCounts[cat.slug] ?? 0}
          </span>
        </button>
      ))}
    </nav>
  );
}
