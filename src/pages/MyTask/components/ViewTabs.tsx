/**
 * ViewTabs 组件
 * 一级 Tab 切换：定时任务 / 执行记录
 * 对应原型 .task-view-tabs
 */

import { cn } from '@/lib/utils';
import type { TaskView } from '../types';

interface ViewTabsProps {
  /** 当前激活的视图 */
  activeView: TaskView;
  /** 视图切换回调 */
  onViewChange: (view: TaskView) => void;
}

/** 视图 Tab 配置 */
const VIEW_TABS: { value: TaskView; label: string }[] = [
  { value: 'tasks', label: '定时任务' },
  { value: 'records', label: '执行记录' },
];

export function ViewTabs({ activeView, onViewChange }: ViewTabsProps) {
  return (
    <div className="flex items-center gap-5" role="tablist" aria-label="任务视图">
      {VIEW_TABS.map((tab) => {
        const isActive = activeView === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onViewChange(tab.value)}
            className={cn(
              'bg-transparent cursor-pointer text-left transition-[font-weight,color,border-color]',
              'text-[16px] pt-2 pb-2 font-family-inherit border-b',
              isActive
                ? 'font-bold text-foreground border-foreground'
                : 'font-medium text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
