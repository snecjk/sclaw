import { Search, ArrowUpDown, ChevronDown, Check, LayoutGrid, List } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function SkillPlazaToolbar() {
  const { t } = useTranslation('skills');
  const {
    activeTab,
    searchQuery,
    sortMode,
    viewMode,
    setActiveTab,
    setSearchQuery,
    setSortMode,
    setViewMode,
  } = useSkillPlazaStore();

  const isMine = activeTab === 'mine';

  const sortOptions = [
    { value: 'hot' as const, label: t('plaza.sort.hot', { defaultValue: '热门' }) },
    { value: 'recent' as const, label: t('plaza.sort.recent', { defaultValue: '最近' }) },
  ];
  const currentSortLabel = sortOptions.find((o) => o.value === sortMode)?.label ?? '';

  return (
    <div className="flex flex-wrap items-center gap-4 w-full mb-0">
      {/* Tabs on the left */}
      <div className="flex items-center gap-5">
        {(
          [
            { key: 'all' as const, label: t('plaza.tab.all', { defaultValue: '技能广场' }) },
            { key: 'mine' as const, label: t('plaza.tab.mine', { defaultValue: '我的技能' }) },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'm-0 pb-2 border-none bg-transparent font-medium cursor-pointer text-sm transition-colors',
              activeTab === tab.key
                ? 'text-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters on the right */}
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        {/* Search */}
        <label className="flex items-center gap-2 h-8 px-3 py-0 rounded-[10px] border border-border bg-white min-w-[280px] max-w-[360px] flex-1">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            type="search"
            placeholder={t('plaza.searchPlaceholder', { defaultValue: '搜索技能名称或描述…' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 w-auto min-w-0 h-[30px] p-0 border-none bg-transparent text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="group flex items-center gap-1.5 h-8 px-2.5 rounded-[10px] border border-border bg-white text-[13px] font-medium text-foreground cursor-pointer hover:border-[#dfe2e8] hover:bg-[#fafbfc] transition-colors">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="whitespace-nowrap">{t('plaza.sort.prefix', { defaultValue: '排序' })}：{currentSortLabel}</span>
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

        {/* View toggle (mine tab only) */}
        {isMine && (
          <div className="inline-flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'inline-flex items-center justify-center w-8 h-8 p-0 border rounded-lg cursor-pointer transition-colors',
                viewMode === 'grid'
                  ? 'text-[#ff6700] bg-white border-black/5 shadow-sm'
                  : 'text-muted-foreground bg-white border-black/5 hover:text-foreground hover:border-black/10',
              )}
              title={t('plaza.view.grid', { defaultValue: '宫格视图' })}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'inline-flex items-center justify-center w-8 h-8 p-0 border rounded-lg cursor-pointer transition-colors',
                viewMode === 'list'
                  ? 'text-[#ff6700] bg-white border-black/5 shadow-sm'
                  : 'text-muted-foreground bg-white border-black/5 hover:text-foreground hover:border-black/10',
              )}
              title={t('plaza.view.list', { defaultValue: '条目视图' })}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
