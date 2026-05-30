import { Search, LayoutGrid, List, ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
    setSearchQuery,
    setSortMode,
    setViewMode,
  } = useSkillPlazaStore();

  const isMine = activeTab === 'mine';

  return (
    <div className="flex items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('plaza.searchPlaceholder', { defaultValue: '搜索技能...' })}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9 bg-background"
        />
      </div>

      {/* Sort */}
      <div className="relative">
        <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as 'hot' | 'recent')}
          className={cn(
            'h-9 pl-8 pr-7 text-sm rounded-md border border-border bg-background',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'appearance-none cursor-pointer',
          )}
        >
          <option value="hot">{t('plaza.sort.hot', { defaultValue: '热门' })}</option>
          <option value="recent">{t('plaza.sort.recent', { defaultValue: '最近' })}</option>
        </select>
      </div>

      {/* View toggle (mine tab only) */}
      {isMine && (
        <div className="flex items-center rounded-md border border-border bg-background p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            aria-pressed={viewMode === 'grid'}
            className={cn(
              'p-1.5 rounded-sm transition-colors',
              viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            title={t('plaza.view.grid', { defaultValue: '宫格视图' })}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            className={cn(
              'p-1.5 rounded-sm transition-colors',
              viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            title={t('plaza.view.list', { defaultValue: '条目视图' })}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
