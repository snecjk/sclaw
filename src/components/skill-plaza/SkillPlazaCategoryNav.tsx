import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { cn } from '@/lib/utils';

export function SkillPlazaCategoryNav() {
  const { categories, categoryCounts, activeCategory, setActiveCategory } = useSkillPlazaStore();

  const displayCategories = categories;

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 my-2.5 mx-0 p-0" aria-label="技能分类">
      {displayCategories.map((cat) => (
        <button
          key={cat.slug}
          onClick={() => setActiveCategory(cat.slug)}
          className={cn(
            'inline-flex items-center gap-0.5 px-3 py-1.5 border-none rounded-lg bg-transparent text-sm font-medium whitespace-nowrap cursor-pointer transition-colors',
            activeCategory === cat.slug
              ? 'bg-[#e5e7eb] text-[#111827] font-semibold'
              : 'text-[#9ca3af] hover:text-[#6b7280]',
          )}
        >
          <span>{cat.label}</span>
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              activeCategory === cat.slug ? 'text-[#6b7280]' : 'text-[#b0b7c3]',
            )}
          >
            {categoryCounts[cat.slug] ?? 0}
          </span>
        </button>
      ))}
    </nav>
  );
}
