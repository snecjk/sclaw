/**
 * TaskToolbar 组件
 * 定时任务视图工具栏：搜索 + 排序（靠右对齐）
 */

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  workflowListSearchIconWrapClass,
  workflowListSearchInputClass,
  workflowListSearchLabelClass,
} from '@/lib/surfaces';
import { SORT_OPTIONS } from '../constants';

interface TaskToolbarProps {
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索变化回调 */
  onSearchChange: (query: string) => void;
  /** 当前排序值 */
  sortValue: string;
  /** 排序变化回调 */
  onSortChange: (value: string) => void;
}

export function TaskToolbar({
  searchQuery,
  onSearchChange,
  sortValue,
  onSortChange,
}: TaskToolbarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭排序下拉
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

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sortValue)?.label || SORT_OPTIONS[0].label;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      {/* 搜索框 */}
      <label className={workflowListSearchLabelClass}>
        <span className="sr-only">搜索定时任务名称</span>
        <span className={workflowListSearchIconWrapClass} aria-hidden="true">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={workflowListSearchInputClass}
          placeholder="搜索任务名称"
          autoComplete="off"
        />
      </label>

      {/* 排序下拉 */}
      <div className="relative" ref={sortRef}>
        <button
          type="button"
          onClick={() => setSortOpen(!sortOpen)}
          className="flex items-center gap-[6px] h-[34px] px-[10px] text-[13px] font-medium rounded-[10px] border border-border bg-card text-foreground hover:border-[#c5cad3] transition-[border-color,box-shadow] focus-visible:border-[#c5cad3] focus-visible:shadow-[0_0_0_3px_rgba(15,23,42,0.06)]"
          aria-label="排序方式"
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" className="shrink-0 text-muted-foreground">
            <path d="M4 6h16M8 12h8M11 18h2" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline whitespace-nowrap">{currentSortLabel}</span>
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', sortOpen && 'rotate-180')}
          />
        </button>
        {sortOpen && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-max min-w-full rounded-[12px] border border-border bg-card p-[6px] shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
            {SORT_OPTIONS.map((opt) => {
              const isSelected = sortValue === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSortChange(opt.value);
                    setSortOpen(false);
                  }}
                  className={cn(
                    'flex items-center justify-between gap-2 w-full min-h-[36px] text-left px-[10px] py-[8px] rounded-[8px] text-[13px] whitespace-nowrap transition-[background,color]',
                    isSelected
                      ? 'bg-[#fff3e0] text-[#ff8c00] font-semibold'
                      : 'text-foreground hover:bg-[#fff3e0] hover:text-[#ff8c00]',
                  )}
                >
                  <span className="flex-1 min-w-0 text-left">{opt.label}</span>
                  <Check className={cn('h-4 w-4 shrink-0 text-[#ff8c00]', isSelected ? 'opacity-1' : 'opacity-0')} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
