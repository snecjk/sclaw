/**
 * TaskEmptyState 组件
 * 定时任务空状态：无任务时显示提示 + 下拉创建按钮，搜索无结果时显示提示
 * 模版卡片已移至 TemplateSelectModal，不再在此组件中展示
 */

import { useTranslation } from 'react-i18next';
import listEmptyIcon from '@/assets/task-list-empty-icon.png';
import searchEmptyIcon from '@/assets/task-search-empty-icon.png';
import { NewTaskDropdownButton } from './NewTaskDropdownButton';

interface TaskEmptyStateProps {
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 自己创建回调：打开 TaskCreateModal */
  onSelfCreate: () => void;
  /** 模版创建回调：打开 TemplateSelectModal */
  onTemplateCreate: () => void;
}

export function TaskEmptyState({ searchQuery, onSelfCreate, onTemplateCreate }: TaskEmptyStateProps) {
  const { t } = useTranslation('tasks');

  if (searchQuery) {
    return (
      <div className="flex w-full flex-col items-start">
        <div className="flex w-full flex-col items-center justify-start gap-1.5 py-8 pb-6">
          <img
            src={searchEmptyIcon}
            alt=""
            width="120"
            height="120"
            decoding="async"
            className="pointer-events-none mb-0.5 block h-auto w-[min(120px,32vw)] select-none opacity-90 dark:opacity-75"
          />
          <h2 className="m-0 text-center text-[18px] font-semibold leading-[1.4] text-foreground">
            {t('myTask.empty.searchNoMatch')}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-start gap-1.5 py-8 pb-6">
      <img
        src={listEmptyIcon}
        alt=""
        width="120"
        height="120"
        decoding="async"
        className="pointer-events-none mb-0.5 block h-auto w-[min(120px,32vw)] select-none opacity-90 dark:opacity-75"
      />
      <h2 className="m-0 text-center text-[18px] font-semibold leading-[1.4] text-foreground">
        {t('myTask.empty.noTasks')}
      </h2>
      <p className="m-0 max-w-[420px] text-center text-sm font-normal leading-[1.5] text-muted-foreground">
        {t('myTask.empty.noTasksDescription')}
      </p>
      <div className="mt-1.5 mb-0">
        <NewTaskDropdownButton onSelfCreate={onSelfCreate} onTemplateCreate={onTemplateCreate} />
      </div>
    </div>
  );
}
