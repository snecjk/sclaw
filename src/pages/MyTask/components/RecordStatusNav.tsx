/**
 * RecordStatusNav 组件
 * 执行记录二级状态筛选导航；样式与工作流列表 {@link workflowListSubnavClass} 对齐。
 */

import {
  workflowListSubnavClass,
  workflowListSubnavCountClass,
  workflowListSubnavNavClass,
  workflowListSubnavSlotClass,
} from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('tasks');

  return (
    <div className={workflowListSubnavSlotClass}>
      <nav className={workflowListSubnavNavClass} aria-label={t('myTask.recordStatusNav.aria')}>
        {RECORD_STATUS_TABS.map((tab) => {
          const isActive = activeStatus === tab.value;
          const count = counts[tab.value];
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onStatusChange(tab.value)}
              aria-selected={isActive}
              className={workflowListSubnavClass(isActive)}
            >
              <span>{t(tab.i18nKey)}</span>
              <span className={workflowListSubnavCountClass(isActive)}>{count}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
