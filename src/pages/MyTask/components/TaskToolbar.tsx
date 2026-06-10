/**
 * TaskToolbar 组件
 * 定时任务视图的工具栏：搜索 + 排序 + 新建按钮
 * 对应原型 .task-page__hero-actions
 */

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /** 新建任务回调 */
  onCreate: () => void;
}

export function TaskToolbar({
  searchQuery,
  onSearchChange,
  sortValue,
  onSortChange,
  onCreate,
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
    <div className="flex items-center gap-3">
      {/* 搜索框 */}
      <label className="relative flex items-center">
        <span className="sr-only">搜索定时任务名称</span>
        <span className="absolute left-3 text-muted-foreground" aria-hidden="true">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-[34px] pl-[30px] pr-[10px] w-[184px] text-[13px] rounded-[8px] border border-border bg-[#fff] placeholder:text-muted-foreground focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] focus:ring-0"
          placeholder="搜索任务名称"
          autoComplete="off"
        />
      </label>

      {/* 排序下拉 */}
      <div className="relative" ref={sortRef}>
        <button
          type="button"
          onClick={() => setSortOpen(!sortOpen)}
          className="flex items-center gap-[6px] h-[34px] px-[10px] text-[13px] font-medium rounded-[10px] border border-border bg-[#fff] text-foreground hover:border-[#c5cad3] transition-[border-color,box-shadow] focus-visible:border-[#c5cad3] focus-visible:shadow-[0_0_0_3px_rgba(15,23,42,0.06)]"
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
          <div className="absolute right-0 top-[calc(100%+6px)] w-max min-w-full bg-[#fff] border border-border rounded-[12px] shadow-[0_12px_32px_rgba(15,23,42,0.12)] p-[6px] z-30">
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

      {/* 新建按钮 — 原型：黑底白字 + 投影 */}
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center gap-1.5 h-[34px] px-[14px] text-[14px] font-semibold rounded-lg bg-[#111] text-white shadow-[0_2px_10px_rgba(0,0,0,0.15)] hover:brightness-[1.08] active:brightness-[0.96] transition-[background,box-shadow,filter] font-family-inherit"
      >
        + 新建定时任务
      </button>
    </div>
  );
}
