import { ArrowUpDown, ChevronDown, Check, LayoutGrid, List } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { cn } from '@/lib/utils';
import { computeMineCategoryCounts } from '@/lib/skill-plaza-category';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function SkillPlazaCategoryNav() {
  const { t } = useTranslation('skills');
  const {
    categories,
    categoryCounts,
    activeCategory,
    setActiveCategory,
    activeTab,
    mySkills,
    searchQuery,
    plazaSkillMetaMap,
    plazaSkills,
    sortMode,
    viewMode,
    setSortMode,
    setViewMode,
  } = useSkillPlazaStore();

  const isMine = activeTab === 'mine';

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

    return computeMineCategoryCounts(filtered, categories, plazaSkillMetaMap, plazaSkills);
  }, [activeTab, categoryCounts, mySkills, searchQuery, categories, plazaSkillMetaMap, plazaSkills]);

  const sortOptions = [
    { value: 'hot' as const, label: t('plaza.sort.hot', { defaultValue: '热门' }) },
    { value: 'recent' as const, label: t('plaza.sort.recent', { defaultValue: '最近' }) },
  ];
  const currentSortLabel = sortOptions.find((o) => o.value === sortMode)?.label ?? '';

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-2">
      <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 p-0" aria-label="技能分类">
        {categories.map((cat) => (
          <button
            key={cat.slug}
            type="button"
            onClick={() => setActiveCategory(cat.slug)}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-[12px] border-none bg-transparent px-3 py-1.5 font-['PingFang_SC'] text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors",
              activeCategory === cat.slug
                ? 'bg-[#E5E6EB] text-[#1D2129] font-semibold'
                : 'text-[#86909C] hover:text-[#1D2129]',
            )}
          >
            <span>{cat.label}</span>
            <span
              className={cn(
                'text-[13px] font-medium tabular-nums',
                activeCategory === cat.slug ? 'text-[#86909C]' : 'text-[#C9CDD4]',
              )}
            >
              {displayCounts[cat.slug] ?? 0}
            </span>
          </button>
        ))}
      </nav>

      {isMine ? (
        <div className="inline-flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[12px] border p-0 transition-colors hover:bg-[#F2F3F5]',
              viewMode === 'grid'
                ? 'border-border bg-white text-[#ff6700] shadow-sm'
                : 'border-border bg-white text-[#86909C] hover:text-[#1D2129]',
            )}
            title={t('plaza.view.grid', { defaultValue: '宫格视图' })}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[12px] border p-0 transition-colors hover:bg-[#F2F3F5]',
              viewMode === 'list'
                ? 'border-border bg-white text-[#ff6700] shadow-sm'
                : 'border-border bg-white text-[#86909C] hover:text-[#1D2129]',
            )}
            title={t('plaza.view.list', { defaultValue: '条目视图' })}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-[12px] border border-border bg-white px-2.5 text-[13px] font-medium text-[#1D2129] transition-colors hover:bg-[#F2F3F5]"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="whitespace-nowrap">
                {t('plaza.sort.prefix', { defaultValue: '排序' })}：{currentSortLabel}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setSortMode(option.value)}
                className="flex items-center justify-between"
              >
                <span>{option.label}</span>
                {sortMode === option.value && <Check className="h-4 w-4 text-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
