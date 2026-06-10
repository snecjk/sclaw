/**
 * RecordStatusNav 组件
 * 执行记录二级状态筛选导航
 * 对应原型 .task-record-nav
 */

import { cn } from '@/lib/utils';
import { RECORD_STATUS_TABS } from '../constants';
import type { RecordStatus, StatusCounts } from '../types';

interface RecordStatusNavProps {
  /** 当前选中的状态 */
  activeStatus: RecordStatus;
  /** 各状态计数 */
  counts: StatusCounts;
  /** 状态切换回调 */
  onStatusChange: (status: RecordStatus) => void;
}

export function RecordStatusNav({ activeStatus, counts, onStatusChange }: RecordStatusNavProps) {
  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 m-0 mb-4 p-0" aria-label="按执行状态筛选">
      {RECORD_STATUS_TABS.map((tab) => {
        const isActive = activeStatus === tab.value;
        const count = counts[tab.value];
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onStatusChange(tab.value)}
            aria-selected={isActive}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 border-none rounded-lg text-[14px] font-medium font-family-inherit leading-[1.35] whitespace-nowrap transition-colors',
              isActive
                ? 'bg-[#e5e7eb] text-[#111827] font-semibold'
                : 'bg-transparent text-[#9ca3af] hover:text-[#6b7280]',
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                'text-[14px] font-medium tabular-nums',
                isActive ? 'text-[#6b7280]' : 'text-[#b0b7c3]',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
