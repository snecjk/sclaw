/**
 * TaskToolbar 组件
 * 定时任务视图二级工具栏：仅排序（靠右）；搜索/新建已上移至一级顶栏
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  dropdownOptionClass,
  dropdownPanelRoundedClass,
  myTaskSortTriggerClass,
} from '@/lib/surfaces';
import { SORT_OPTIONS } from '../constants';

interface TaskToolbarProps {
  /** 当前排序值 */
  sortValue: string;
  /** 排序变化回调 */
  onSortChange: (value: string) => void;
}

export function TaskToolbar({ sortValue, onSortChange }: TaskToolbarProps) {
  const { t } = useTranslation('tasks');
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

  const currentSortOption =
    SORT_OPTIONS.find((o) => o.value === sortValue) ?? SORT_OPTIONS[0];

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      <div className="relative" ref={sortRef}>
        <button
          type="button"
          onClick={() => setSortOpen(!sortOpen)}
          className={myTaskSortTriggerClass}
          aria-label={t('myTask.toolbar.sortAria')}
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="shrink-0 text-muted-foreground"
          >
            <path d="M4 6h16M8 12h8M11 18h2" strokeLinecap="round" />
          </svg>
          <span className="hidden whitespace-nowrap sm:inline">{t(currentSortOption.i18nKey)}</span>
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', sortOpen && 'rotate-180')}
          />
        </button>
        {sortOpen && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-max min-w-full">
            <div className={dropdownPanelRoundedClass} role="listbox">
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
                      'flex w-full min-h-[36px] items-center justify-between gap-2 rounded-[8px] px-[10px] py-[8px] text-left text-[13px] whitespace-nowrap',
                      dropdownOptionClass(isSelected),
                    )}
                  >
                    <span className="min-w-0 flex-1 text-left">{t(opt.i18nKey)}</span>
                    <Check className={cn('h-4 w-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0')} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
