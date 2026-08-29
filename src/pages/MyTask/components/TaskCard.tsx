/**
 * TaskCard 组件
 * 我的任务 — 定时任务卡片（图示：图标+标题+开关 / 描述 / 计划时间+立即运行+更多）
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Loader2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseScheduleToLabel } from '@/lib/schedule-label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  myTaskCardBodyClass,
  myTaskCardDescriptionClass,
  myTaskCardDetailFooterGapClass,
  myTaskCardFooterActionsClass,
  myTaskCardFooterClass,
  myTaskCardMenuClass,
  myTaskCardMenuItemClass,
  myTaskCardRunButtonClass,
  myTaskCardScheduleRowClass,
  myTaskCardShellClass,
  myTaskCardTitleClass,
  myTaskCardTitleRowClass,
  myTaskCardTopRowClass,
  myTaskWorkflowBadgeClass,
  scheduleToggleThumbClass,
  scheduleToggleTrackClass,
} from '@/lib/surfaces';
import type { TaskViewModel } from '../types';

/** TaskCard 接收的任务数据 */
interface TaskCardData extends TaskViewModel {
  /** 人类可读的计划时间文本（可选，缺省显示 cronExpr） */
  scheduleText?: string;
}

interface TaskCardProps {
  /** 任务数据 */
  task: TaskCardData;
  /** 编辑任务回调 */
  onEdit?: (task: TaskCardData) => void;
  /** 删除任务回调 */
  onDelete?: (task: TaskCardData) => void;
  /** 立即运行回调（返回 Promise 以驱动 loading） */
  onRun?: (task: TaskCardData) => Promise<void> | void;
  /** 开关切换回调 */
  onToggle?: (enabled: boolean) => void;
  /** 点击卡片回调（编辑） */
  onClick?: (task: TaskCardData) => void;
}

export function TaskCard({ task, onEdit, onDelete, onRun, onToggle, onClick }: TaskCardProps) {
  const { t } = useTranslation('tasks');
  const [running, setRunning] = useState(false);

  const handleBodyClick = () => {
    onClick?.(task);
  };

  const handleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (running) return;
    setRunning(true);
    try {
      await onRun?.(task);
    } finally {
      setRunning(false);
    }
  };

  const scheduleLabel = task.scheduleText ?? parseScheduleToLabel(task.cronExpr);
  // 卡片只标「工作流任务」；技能留在 composer 内，不占卡片徽标
  const showWorkflowBadge = Boolean(task.hasWorkflow);

  return (
    <article className={myTaskCardShellClass}>
      {/* 顶栏：时钟图标 + 标题 + badge | 开关 */}
      <div className={myTaskCardTopRowClass}>
        <div className={myTaskCardTitleRowClass}>
          <Clock
            className="h-4 w-4 shrink-0 text-[var(--sto-text-secondary)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className={myTaskCardTitleClass} title={task.name}>{task.name}</h3>
          {showWorkflowBadge ? (
            <span className={myTaskWorkflowBadgeClass}>
              {t('myTask.card.workflowBadge')}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={task.enabled}
          aria-pressed={task.enabled}
          aria-label={t('myTask.card.toggleAria')}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(!task.enabled);
          }}
          className={scheduleToggleTrackClass(task.enabled)}
        >
          <span
            className={cn(scheduleToggleThumbClass, task.enabled && 'translate-x-4')}
          />
        </button>
      </div>

      {/* 描述 — 点击打开编辑 */}
      {task.description ? (
        <div
          className={cn(myTaskCardBodyClass, onClick && 'cursor-pointer')}
          onClick={onClick ? handleBodyClick : undefined}
        >
          <p className={myTaskCardDescriptionClass}>{task.description}</p>
        </div>
      ) : (
        <div
          className={cn(myTaskCardBodyClass, onClick && 'cursor-pointer')}
          aria-hidden={!onClick}
          onClick={onClick ? handleBodyClick : undefined}
        />
      )}

      {/* 详情与底栏之间：最小 18px，同行等高时由此吸收高度差 */}
      <div className={myTaskCardDetailFooterGapClass} aria-hidden />

      {/* 底栏：计划时间 | 立即运行 + 更多 */}
      <div className={myTaskCardFooterClass}>
        <span className={myTaskCardScheduleRowClass} title={scheduleLabel}>
          {scheduleLabel}
        </span>

        <div className={myTaskCardFooterActionsClass}>
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className={myTaskCardRunButtonClass}
          >
            {running ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('myTask.card.running')}
              </span>
            ) : (
              t('myTask.card.runNow')
            )}
          </button>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('myTask.card.moreAria')}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={6}
              collisionPadding={8}
              className={myTaskCardMenuClass}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className={myTaskCardMenuItemClass()}
                onSelect={() => onEdit?.(task)}
              >
                {t('myTask.card.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={myTaskCardMenuItemClass(true)}
                onSelect={() => onDelete?.(task)}
              >
                {t('myTask.card.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
