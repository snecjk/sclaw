/**
 * RecordToolbar 组件
 * 执行记录视图的工具栏：搜索 + 任务类型筛选下拉
 * 对应原型 .task-record-toolbar
 */

import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  workflowListSearchIconWrapClass,
  workflowListSearchInputClass,
  workflowListSearchLabelClass,
} from '@/lib/surfaces';
import { RECORD_TYPE_OPTIONS } from '../constants';
import type { TaskType } from '../types';

interface RecordToolbarProps {
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索变化回调 */
  onSearchChange: (query: string) => void;
  /** 当前任务类型筛选 */
  filterType: TaskType | 'all';
  /** 类型筛选变化回调 */
  onFilterChange: (type: TaskType | 'all') => void;
}

export function RecordToolbar({
  searchQuery,
  onSearchChange,
  filterType,
  onFilterChange,
}: RecordToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭筛选下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    if (filterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [filterOpen]);

  const currentFilterLabel =
    RECORD_TYPE_OPTIONS.find((o) => o.value === filterType)?.label || RECORD_TYPE_OPTIONS[0].label;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      {/* 搜索框 */}
      <label className={workflowListSearchLabelClass}>
        <span className="sr-only">搜索执行记录任务名称</span>
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

      {/* 任务类型筛选下拉 */}
      <div className={cn('relative', filterOpen && 'is-open')} ref={filterRef}>
        <button
          type="button"
          onClick={() => setFilterOpen(!filterOpen)}
          className="flex h-[34px] items-center gap-[6px] whitespace-nowrap rounded-[8px] border border-border bg-card px-[12px] text-[13px] text-foreground transition-[border-color] hover:border-[#c5cad3]"
          aria-haspopup="listbox"
          aria-expanded={filterOpen}
        >
          {/* 筛选图标 */}
          <span className="inline-flex text-muted-foreground" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 5h16l-6 7v6l-4 2v-8z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>{currentFilterLabel}</span>
          <ChevronDown
            className={cn('h-3 w-3 text-muted-foreground transition-transform', filterOpen && 'rotate-180')}
          />
        </button>

        {filterOpen && (
          <div
            className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[148px] rounded-[10px] border border-border bg-card p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
            role="listbox"
            aria-label="任务类型"
          >
            {RECORD_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={filterType === opt.value}
                onClick={() => {
                  onFilterChange(opt.value as TaskType | 'all');
                  setFilterOpen(false);
                }}
                className={cn(
                  'block w-full text-left px-[10px] py-[8px] text-[13px] rounded-[7px] transition-[background,color] whitespace-nowrap',
                  filterType === opt.value
                    ? 'bg-[#eef0ff] text-[#4f46a8] font-semibold'
                    : 'text-foreground hover:bg-[#f3f4f6]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
