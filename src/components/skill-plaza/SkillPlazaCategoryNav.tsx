import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

export function SkillPlazaCategoryNav() {
  const { categories, categoryCounts, activeCategory, setActiveCategory, activeTab, mySkills, searchQuery, plazaSkillMetaMap } = useSkillPlazaStore();

  // Plaza tab: trust backend categoryCounts (computed from the full search scope).
  // Mine tab: derive counts from the enriched local list so UI stays in sync with search.
  const displayCounts = useMemo(() => {
    if (activeTab !== 'mine') return categoryCounts;

    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? mySkills.filter((s) =>
          s.title.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
        )
      : mySkills;

    const counts: Record<string, number> = {};
    counts[''] = filtered.length;

    for (const skill of filtered) {
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
  }, [activeTab, categoryCounts, mySkills, searchQuery, plazaSkillMetaMap, categories]);

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
