/**
 * ViewTabs 组件
 * 一级 Tab 切换：定时任务 / 执行记录（无下划线，与工作流列表主 Tab 一致）
 */

import { useTranslation } from 'react-i18next';
import { workflowListTabClass } from '@/lib/surfaces';
import type { TaskView } from '../types';

interface ViewTabsProps {
  /** 当前激活的视图 */
  activeView: TaskView;
  /** 视图切换回调 */
  onViewChange: (view: TaskView) => void;
}

/** 视图 Tab 配置 */
const VIEW_TABS: { value: TaskView; i18nKey: string }[] = [
  { value: 'tasks', i18nKey: 'myTask.viewTabs.tasks' },
  { value: 'records', i18nKey: 'myTask.viewTabs.records' },
];

export function ViewTabs({ activeView, onViewChange }: ViewTabsProps) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex items-center gap-5" role="tablist" aria-label={t('myTask.viewTabs.aria')}>
      {VIEW_TABS.map((tab) => {
        const isActive = activeView === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onViewChange(tab.value)}
            className={workflowListTabClass(isActive)}
          >
            {t(tab.i18nKey)}
          </button>
        );
      })}
    </div>
  );
}
