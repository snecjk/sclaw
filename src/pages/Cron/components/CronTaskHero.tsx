import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stoPageTitleClass } from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';

interface CronTaskHeroProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  onCreate: () => void;
  totalCount: number;
  isGatewayRunning: boolean;
}

const SORT_OPTIONS = [
  { value: 'created-desc', label: '按创建时间倒序' },
  { value: 'created-asc', label: '按创建时间正序' },
  { value: 'name-asc', label: '按名称 A-Z' },
  { value: 'name-desc', label: '按名称 Z-A' },
];

export function CronTaskHero({ searchQuery, onSearchChange, sortValue, onSortChange, onCreate, totalCount, isGatewayRunning }: CronTaskHeroProps) {
  const { t } = useTranslation('cron');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    if (sortOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [sortOpen]);

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sortValue)?.label || SORT_OPTIONS[0].label;

  return (
    <header className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
        <h1 className={stoPageTitleClass}>{t('title')}</h1>
        <div className="flex items-center gap-3">
          {/* Search */}
          <label className="relative flex items-center">
            <span className="sr-only">搜索定时任务名称</span>
            <span className="absolute left-3 text-muted-foreground" aria-hidden="true">
              <Search className="h-3.5 w-3.5" />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 pl-9 pr-3 text-[13px] rounded-lg border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-48 sm:w-56"
              placeholder="搜索任务名称"
              autoComplete="off"
            />
          </label>

          {/* Sort Picker */}
          <div className="relative" ref={sortRef}>
            <input type="hidden" value={sortValue} />
            <button
              type="button"
              onClick={() => setSortOpen(!sortOpen)}
              className="flex items-center gap-2 h-9 px-3 text-[13px] rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors"
              aria-label="排序方式"
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M4 6h16M8 12h8M11 18h2" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">{currentSortLabel}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", sortOpen && "rotate-180")} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={sortValue === opt.value}
                    onClick={() => { onSortChange(opt.value); setSortOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-[13px] transition-colors",
                      sortValue === opt.value
                        ? "text-primary bg-primary/5 font-medium"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create Button */}
          <button
            type="button"
            onClick={onCreate}
            disabled={!isGatewayRunning}
            className="flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            新建定时任务
          </button>
        </div>
      </div>
      <p className="text-[13.5px] text-muted-foreground leading-relaxed max-w-2xl">
        {t('subtitle')}
        {totalCount > 0 && <span className="ml-1 text-foreground/70">共 {totalCount} 个任务</span>}
      </p>
    </header>
  );
}
