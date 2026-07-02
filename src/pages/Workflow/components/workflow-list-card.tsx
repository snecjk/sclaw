import { MoreHorizontal, Route } from 'lucide-react';
import { Fragment, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  workflowListCardBodyClass,
  workflowListCardCoverClass,
  workflowListCardCoverWrapClass,
  workflowListCardFooterClass,
  workflowListCardFlowBlockClass,
  workflowListCardFlowSepClass,
  workflowListCardFlowStepClass,
  workflowListCardFlowStepsClass,
  workflowListCardFlowTitleClass,
  workflowListCardGridClass,
  workflowListCardHeadClass,
  workflowListCardMainClass,
  workflowListCardMoreActionClass,
  workflowListCardPrimaryActionClass,
  workflowListCardScheduleRowClass,
  workflowListCardSecondaryActionClass,
  workflowListCardShellClass,
  workflowListCardTitleRowClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { WorkflowCardCover } from '@/pages/Workflow/components/workflow-card-cover';
// import { WorkflowScheduleToggle } from '@/pages/Workflow/components/workflow-schedule-toggle';
import type {
  OfficialWorkflowCard,
  WorkflowCardItem,
  WorkflowCoverKey,
} from '@/pages/Workflow/types';

interface WorkflowCardShellProps {
  id: string;
  coverKey: WorkflowCoverKey;
  dimmed?: boolean;
  onCardClick?: () => void;
  children: ReactNode;
}

/** 流程节点路径行（卡片底部的 flow[] 渲染） */
function WorkflowFlowRow({ flow }: { flow: string[] }) {
  const { t } = useTranslation('workflow');
  return (
    <div className={workflowListCardFlowBlockClass}>
      <div className={workflowListCardFlowTitleClass}>
        <Route className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {t('card.flow')}
      </div>
      <div className={workflowListCardFlowStepsClass}>
        {flow.map((step, i) => (
          <Fragment key={step}>
            {i > 0 ? (
              <span className={workflowListCardFlowSepClass} aria-hidden>
                ›
              </span>
            ) : null}
            <span className={workflowListCardFlowStepClass}>{step}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** 卡片通用外壳：头图 + body 区域，点击整体触发 onCardClick */
function WorkflowCardShell({
  id,
  coverKey,
  dimmed,
  onCardClick,
  children,
}: WorkflowCardShellProps) {
  return (
    <article
      data-workflow-id={id}
      className={cn(workflowListCardShellClass, dimmed && 'opacity-[0.82]')}
      onClick={(e) => {
        // if ((e.target as HTMLElement).closest('button, [role="switch"]')) return;
        if ((e.target as HTMLElement).closest('button')) return;
        onCardClick?.();
      }}
    >
      <div className={workflowListCardCoverWrapClass}>
        <WorkflowCardCover coverKey={coverKey} className={workflowListCardCoverClass} />
      </div>
      <div className={workflowListCardBodyClass}>{children}</div>
    </article>
  );
}

export interface WorkflowMineListCardProps {
  card: WorkflowCardItem;
  isRenaming: boolean;
  renameRef?: RefObject<HTMLInputElement | null>;
  onRenameCommit: (name: string) => void;
  // TODO: 等待后端 API 对接
  // onToggleEnabled: (enabled: boolean) => void;
  onCardClick?: () => void;
  onRun: () => void;
  onEdit: () => void;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 「我的工作流」卡片：标题+开关+排期+描述+流程+操作按钮 */
export function WorkflowMineListCard({
  card,
  isRenaming,
  renameRef,
  onRenameCommit,
  // onToggleEnabled,
  onCardClick,
  onRun,
  onEdit,
  onMore,
}: WorkflowMineListCardProps) {
  const { t } = useTranslation('workflow');

  return (
    <WorkflowCardShell
      id={card.id}
      coverKey={card.coverKey}
      dimmed={!card.enabled}
      onCardClick={onCardClick}
    >
      <div className={workflowListCardMainClass}>
        <div className={workflowListCardHeadClass}>
          <div className={workflowListCardTitleRowClass}>
            <div className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
              {isRenaming ? (
                <input
                  ref={renameRef}
                  defaultValue={card.name}
                  className="w-full rounded-md border border-primary/30 px-2 py-0.5 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => onRenameCommit(e.target.value.trim() || card.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {card.name}
                  {card.isCustom ? (
                    <span className="rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('card.customTag')}
                    </span>
                  ) : (
                    <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/70">
                      {t('card.systemTag')}
                    </span>
                  )}
                </span>
              )}
            </div>
            {/* TODO: 等待后端 API 对接 */}
            {/* <WorkflowScheduleToggle
              checked={card.enabled}
              onCheckedChange={onToggleEnabled}
              aria-label={card.enabled ? t('card.pauseSchedule') : t('card.resumeSchedule')}
            /> */}
          </div>
          {card.schedule.trim() || card.showPausedLabel ? (
            <div
              className={cn(
                workflowListCardScheduleRowClass,
                'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5'
              )}
            >
              <span className={cn(card.scheduleMuted && 'text-muted-foreground/80')}>
                {card.schedule}
              </span>
              {card.showPausedLabel ? (
                <span className="text-warning">{t('card.pausedLabel')}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="m-0 text-[13px] leading-relaxed text-foreground/80">{card.description}</p>
        {card.flow.length > 0 ? <WorkflowFlowRow flow={card.flow} /> : null}
      </div>

      <div className={cn(workflowListCardFooterClass, 'flex items-center justify-between gap-2')}>
        <button
          type="button"
          className={workflowListCardMoreActionClass}
          aria-label={t('card.more')}
          onClick={(e) => {
            e.stopPropagation();
            onMore(e);
          }}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={workflowListCardSecondaryActionClass}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            {t('card.edit')}
          </button>
          <button
            type="button"
            className={workflowListCardPrimaryActionClass}
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
          >
            {t('card.run')}
          </button>
        </div>
      </div>
    </WorkflowCardShell>
  );
}

export interface WorkflowOfficialListCardProps {
  card: OfficialWorkflowCard;
  onCardClick?: () => void;
  // TODO: 预览/详情弹窗暂不启用
  // onPreview: () => void;
  onInstall: () => void;
}

/** 「官方推荐」卡片：标题+排期+描述+分类标签+预览/安装（流程节点待接口就绪后接入） */
export function WorkflowOfficialListCard({
  card,
  onCardClick,
  // TODO: 预览/详情弹窗暂不启用
  // onPreview,
  onInstall,
}: WorkflowOfficialListCardProps) {
  const { t } = useTranslation('workflow');

  return (
    <WorkflowCardShell id={card.id} coverKey={card.coverKey} onCardClick={onCardClick}>
      <div className={workflowListCardMainClass}>
        <div className={workflowListCardHeadClass}>
          <div className={workflowListCardTitleRowClass}>
            <div className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
              {card.name}
            </div>
          </div>
          {card.schedule.trim() ? (
            <div className={workflowListCardScheduleRowClass}>{card.schedule}</div>
          ) : null}
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-foreground/80">{card.description}</p>
        {/* TODO: POST /agent/v1/workflow-templates 节点摘要未就绪，card.flow 暂为空；接口稳定后恢复 WorkflowFlowRow */}
        {/* {card.flow.length > 0 ? <WorkflowFlowRow flow={card.flow} /> : null} */}
      </div>
      <div
        className={cn(workflowListCardFooterClass, 'flex flex-wrap items-center justify-end gap-2')}
      >
        <span className="mr-auto rounded-lg bg-muted px-2 py-0.5 text-xs text-foreground/80">
          {card.category}
        </span>
        {/* <button
          type="button"
          className={workflowListCardSecondaryActionClass}
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          {t('card.preview')}
        </button> */}
        <button
          type="button"
          className={workflowListCardPrimaryActionClass}
          onClick={(e) => {
            e.stopPropagation();
            onInstall();
          }}
        >
          {t('card.install')}
        </button>
      </div>
    </WorkflowCardShell>
  );
}

/** 我的工作流 / 官方推荐共用的卡片网格容器 */
export function WorkflowListCardGrid({ children }: { children: ReactNode }) {
  return <div className={workflowListCardGridClass}>{children}</div>;
}
