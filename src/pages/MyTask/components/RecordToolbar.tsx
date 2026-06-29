/**
 * RecordToolbar 组件
 * 执行记录视图的工具栏：仅搜索框
 * 对应原型 .task-record-toolbar
 */

import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  workflowListSearchIconWrapClass,
  workflowListSearchInputClass,
  workflowListSearchLabelClass,
} from '@/lib/surfaces';

interface RecordToolbarProps {
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索变化回调 */
  onSearchChange: (query: string) => void;
}

export function RecordToolbar({
  searchQuery,
  onSearchChange,
}: RecordToolbarProps) {
  const { t } = useTranslation('tasks');

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3">
      {/* 搜索框 */}
      <label className={workflowListSearchLabelClass}>
        <span className="sr-only">{t('myTask.recordToolbar.searchSrOnly')}</span>
        <span className={workflowListSearchIconWrapClass} aria-hidden="true">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={workflowListSearchInputClass}
          placeholder={t('myTask.recordToolbar.searchPlaceholder')}
          autoComplete="off"
        />
      </label>
    </div>
  );
}
