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
import { StoOutlineButton } from '@/components/ui/sto-neutral-controls';
import { stoSortTriggerClass } from '@/lib/surfaces';

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
    total,
  } = useSkillPlazaStore();

  const isMine = activeTab === 'mine';

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

  const sortOptions = [
    { value: 'hot' as const, label: t('plaza.sort.hot', { defaultValue: '热门' }) },
    { value: 'recent' as const, label: t('plaza.sort.recent', { defaultValue: '最近' }) },
  ];
  const currentSortLabel = sortOptions.find((o) => o.value === sortMode)?.label ?? '';

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-2">
      <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 p-0" aria-label="技能分类">
        {categoryItems.map((cat) => (
          <button
            key={cat.slug || 'all'}
            type="button"
            onClick={() => setActiveCategory(cat.slug)}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-[12px] border-none bg-transparent px-3 py-1.5 font-['PingFang_SC'] text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors",
              activeCategory === cat.slug
                ? 'bg-[#E5E6EB] text-[#1D2129] font-semibold dark:bg-[var(--sto-control-active-bg)] dark:text-[var(--sto-text-primary)]'
                : 'text-[#86909C] hover:text-[#1D2129] dark:text-[var(--sto-text-tertiary)] dark:hover:text-[var(--sto-text-primary)]',
            )}
          >
            <span>{cat.label}</span>
            <span
              className={cn(
                'text-[13px] font-medium tabular-nums',
                activeCategory === cat.slug
                  ? 'text-[#86909C] dark:text-[var(--sto-text-secondary)]'
                  : 'text-[#C9CDD4] dark:text-[var(--sto-text-tertiary)]',
              )}
            >
              {cat.slug === ALL_CATEGORY_SLUG ? allCount : displayCounts[cat.slug] ?? 0}
            </span>
          </button>
        ))}
      </nav>

      {isMine ? (
        <div className="inline-flex flex-shrink-0 items-center gap-1">
          <StoOutlineButton
            onClick={() => setViewMode('grid')}
            className={cn(
              'h-8 w-8 cursor-pointer border-border p-0',
              viewMode === 'grid'
                ? 'text-[#ff6700] shadow-sm dark:text-[#ff6700] dark:shadow-none'
                : 'text-[#86909C] hover:text-[#1D2129] dark:text-[var(--sto-text-tertiary)] dark:hover:text-[var(--sto-text-primary)]',
            )}
            title={t('plaza.view.grid', { defaultValue: '宫格视图' })}
          >
            <LayoutGrid className="h-4 w-4" />
          </StoOutlineButton>
          <StoOutlineButton
            onClick={() => setViewMode('list')}
            className={cn(
              'h-8 w-8 cursor-pointer border-border p-0',
              viewMode === 'list'
                ? 'text-[#ff6700] shadow-sm dark:text-[#ff6700] dark:shadow-none'
                : 'text-[#86909C] hover:text-[#1D2129] dark:text-[var(--sto-text-tertiary)] dark:hover:text-[var(--sto-text-primary)]',
            )}
            title={t('plaza.view.list', { defaultValue: '条目视图' })}
          >
            <List className="h-4 w-4" />
          </StoOutlineButton>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                stoSortTriggerClass,
                'group h-8 flex-shrink-0 cursor-pointer gap-1.5 rounded-[12px] border-border px-2.5 text-[13px] font-medium hover:bg-[#F2F3F5] dark:hover:bg-[var(--sto-control-hover-bg)]',
              )}
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
