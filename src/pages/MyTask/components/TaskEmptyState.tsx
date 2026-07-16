/**
 * TaskEmptyState 组件
 * 定时任务空状态：无任务时显示官方推荐工作流模版卡片，搜索无结果时显示提示
 * 对应原型 .task-center-empty
 */

import { useTranslation } from 'react-i18next';
import listEmptyIcon from '@/assets/task-list-empty-icon.png';
import searchEmptyIcon from '@/assets/task-search-empty-icon.png';
import { cn } from '@/lib/utils';
import {
  myTaskEmptyPrimaryCtaClass,
  myTaskEmptyTemplateAddButtonClass,
  myTaskEmptyTemplateCardClass,
} from '@/lib/surfaces';
import type { OfficialWorkflowCard } from '@/types/workflow-list';

interface TaskEmptyStateProps {
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 新建任务回调 */
  onCreate: () => void;
  /** 官方推荐工作流模版列表 */
  officialCards: OfficialWorkflowCard[];
  /** 安装工作流模版回调 */
  onTemplateInstall: (card: OfficialWorkflowCard) => void;
}

export function TaskEmptyState({ searchQuery, onCreate, officialCards, onTemplateInstall }: TaskEmptyStateProps) {
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
    <div className="flex w-full flex-1 flex-col items-start justify-start">
      <div className="flex w-full flex-col items-center justify-start gap-1.5 py-8 pb-6">
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
        <button type="button" onClick={onCreate} className={cn('mt-1.5 mb-0', myTaskEmptyPrimaryCtaClass)}>
          {t('myTask.newTask')}
        </button>
      </div>

      {officialCards.length > 0 && (
        <div className="mt-auto w-full shrink-0 self-stretch">
          <div
            role="list"
            aria-label={t('myTask.empty.officialAria')}
            className="grid grid-cols-1 gap-[clamp(12px,1.4vw,16px)] sm:grid-cols-2 lg:grid-cols-3"
          >
            {officialCards.map((card) => (
              <article key={card.id} role="listitem" className={myTaskEmptyTemplateCardClass}>
                <div className="mb-2 flex items-start gap-2">
                  <svg
                    className="mt-px shrink-0 text-muted-foreground"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <h2 className="m-0 min-w-0 flex-1 text-[15px] font-bold leading-[1.35] tracking-[-0.02em] text-foreground">
                    {card.name}
                  </h2>
                </div>
                <p className="m-0 mb-3 line-clamp-2 flex-1 text-[13px] leading-[1.5] text-muted-foreground">
                  {card.description}
                </p>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-2.5 text-xs">
                  <span className="inline-flex min-w-0 items-center font-normal leading-[1.4] text-muted-foreground">
                    {card.category || t('myTask.empty.templateFallbackCategory')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onTemplateInstall(card)}
                    className={myTaskEmptyTemplateAddButtonClass}
                  >
                    {t('myTask.empty.addTemplate')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
