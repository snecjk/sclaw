import * as Dialog from '@radix-ui/react-dialog';
import {
  Clock,
  Download,
  History,
  Info,
  LayoutGrid,
  MoreHorizontal,
  Package,
  Pause,
  Play,
  Puzzle,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  workflowDetailModalBodyPadClass,
  workflowDetailModalCategoryBadgeClass,
  workflowDetailModalCloseClass,
  workflowDetailModalContentClass,
  workflowDetailModalCoverClass,
  workflowDetailModalCoverWrapClass,
  workflowDetailModalFooterClass,
  workflowDetailModalInfoLabelClass,
  workflowDetailModalInfoRowClass,
  workflowDetailModalMoreActionClass,
  workflowDetailModalOverlayClass,
  workflowDetailModalPrimaryActionClass,
  workflowDetailModalSecondaryActionClass,
  workflowDetailModalSkillTagClass,
  workflowDetailModalStepDescClass,
  workflowDetailModalStepIndexClass,
  workflowDetailModalStepTitleClass,
  workflowDetailModalStepTitleRowClass,
  workflowDetailModalStepsHeadingClass,
  workflowDetailModalStepsSectionClass,
  workflowDetailModalTitleBlockClass,
  workflowListCardMenuClass,
  workflowListCardMenuItemClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { WorkflowCardCover } from '@/pages/Workflow/components/workflow-card-cover';
import { WorkflowStatusBadge } from '@/pages/Workflow/components/workflow-status-badge';
import type {
  OfficialWorkflowCard,
  WorkflowCardItem,
  WorkflowDetailData,
} from '@/pages/Workflow/types';

/** 详情弹窗的展示模式：installed = 已安装可运行，preview = 官方可安装，draft = 草稿可编辑 */
export type WorkflowDetailMode = 'installed' | 'preview' | 'draft';

interface WorkflowDetailModalProps {
  open: boolean;
  mode: WorkflowDetailMode;
  card: WorkflowCardItem | OfficialWorkflowCard | null;
  detail: WorkflowDetailData | null;
  onClose: () => void;
  onRun?: () => void;
  onEdit?: () => void;
  onInstall?: () => void;
  onTryRun?: () => void;
  onToggleSchedule?: () => void;
  onRename?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}

/** 类型守卫：区分「我的」卡片（有 enabled 字段）和「官方」卡片 */
function isMineCard(card: WorkflowCardItem | OfficialWorkflowCard): card is WorkflowCardItem {
  return 'enabled' in card;
}

const DETAIL_MORE_MENU_WIDTH = 208;
const DETAIL_MORE_MENU_GAP = 8;

/** 工作流详情弹窗：头图 + 标题/状态 + 信息行 + 步骤时间轴 + Footer 操作按钮（按 mode 切换） */
export function WorkflowDetailModal({
  open,
  mode,
  card,
  detail,
  onClose,
  onRun,
  onEdit,
  onInstall,
  onTryRun,
  onToggleSchedule,
  onRename,
  onShare,
  onDelete,
}: WorkflowDetailModalProps) {
  const { t } = useTranslation('workflow');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState({ x: 0, y: 0 });

  const openMoreMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMoreMenuPos({
      x: Math.min(
        Math.max(DETAIL_MORE_MENU_GAP, rect.left),
        window.innerWidth - DETAIL_MORE_MENU_WIDTH - DETAIL_MORE_MENU_GAP,
      ),
      y: rect.top - DETAIL_MORE_MENU_GAP,
    });
    setMoreOpen((v) => !v);
  };

  if (!card) return null;

  const mine = isMineCard(card);
  const skillCount = detail
    ? new Set(detail.steps.flatMap((s) => s.skills ?? [])).size
    : 0;

  const runStatusText =
    detail?.monthRunCount != null
      ? t('detail.monthRuns', { count: detail.monthRunCount })
      : mine && card.neverRun
        ? t('detail.neverRun')
        : t('detail.monthRuns', { count: 4 });

  const runDurationText =
    detail?.estimatedDuration ?? t('detail.estimatedDurationFallback');

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setMoreOpen(false);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('fixed inset-0 z-[120]', workflowDetailModalOverlayClass)}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[121] -translate-x-1/2 -translate-y-1/2',
            workflowDetailModalContentClass,
          )}
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            if (moreOpen) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (moreOpen) e.preventDefault();
          }}
        >
          <div className={workflowDetailModalCoverWrapClass}>
            <WorkflowCardCover
              coverKey={card.coverKey}
              className={workflowDetailModalCoverClass}
            />
            <button
              type="button"
              className={workflowDetailModalCloseClass}
              aria-label={t('detail.close')}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={workflowDetailModalTitleBlockClass}>
              <Dialog.Title className="text-[18px] font-medium leading-6 text-foreground">
                {card.name}
              </Dialog.Title>
              {!isMineCard(card) ? (
                <span className={workflowDetailModalCategoryBadgeClass}>
                  {card.category}
                </span>
              ) : null}
              {mine ? (
                <WorkflowStatusBadge variant={card.enabled ? 'on' : 'off'}>
                  {card.enabled ? t('detail.scheduleOn') : t('detail.scheduleOff')}
                </WorkflowStatusBadge>
              ) : null}
              <p className="mt-2 basis-full text-[13px] leading-4 text-muted-foreground">
                {card.description}
              </p>
            </div>

            <div className={workflowDetailModalBodyPadClass}>
              <div className={workflowDetailModalInfoRowClass}>
                <span className={workflowDetailModalInfoLabelClass}>
                  <Package className="hidden h-4 w-4" aria-hidden />
                  {t('detail.produces')}
                </span>
                <span className="text-foreground">
                  {detail?.produces ?? t('detail.producesFallback')}
                </span>
              </div>

              <div className={workflowDetailModalInfoRowClass}>
                <span className={workflowDetailModalInfoLabelClass}>
                  <Clock className="hidden h-4 w-4" aria-hidden />
                  {t('detail.runDuration')}
                </span>
                <span className="text-foreground">{runDurationText}</span>
              </div>

              <div className={cn(workflowDetailModalInfoRowClass, 'border-b-0')}>
                <span className={workflowDetailModalInfoLabelClass}>
                  <History className="hidden h-4 w-4" aria-hidden />
                  {t('detail.runHistory')}
                </span>
                <span className="text-foreground">{runStatusText}</span>
              </div>
            </div>

            {detail && detail.steps.length > 0 ? (
              <div className={workflowDetailModalStepsSectionClass}>
                <h3 className={workflowDetailModalStepsHeadingClass}>
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  {t('detail.howItWorks', { steps: detail.steps.length, skills: skillCount })}
                </h3>
                <div className="space-y-0">
                  {detail.steps.map((step, i) => (
                    <div key={step.title} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={workflowDetailModalStepIndexClass}>{i + 1}</span>
                        {i < detail.steps.length - 1 ? (
                          <span className="my-0.5 min-h-[14px] w-[1.5px] flex-1 bg-border" />
                        ) : null}
                      </div>
                      <div className="min-w-0 pb-4">
                        <div className={workflowDetailModalStepTitleRowClass}>
                          <span className={workflowDetailModalStepTitleClass}>{step.title}</span>
                          <span className={workflowDetailModalStepDescClass}>{step.description}</span>
                        </div>
                        {(step.skills?.length ?? 0) > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                            <span className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground">
                              <Puzzle className="hidden h-3.5 w-3.5" aria-hidden />
                              {t('detail.skills')}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {step.skills?.map((sk) => (
                                <span key={sk} className={workflowDetailModalSkillTagClass}>
                                  {sk}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === 'preview' ? (
              <p
                className={cn(
                  'flex items-start gap-1.5 pb-4 pt-2 text-xs leading-relaxed text-muted-foreground',
                  workflowDetailModalBodyPadClass,
                )}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('detail.previewHint')}
              </p>
            ) : null}
          </div>

          <div className={workflowDetailModalFooterClass}>
            {mode === 'preview' ? (
              <>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  className={workflowDetailModalSecondaryActionClass}
                  title={t('detail.tryRunHint')}
                  onClick={onTryRun}
                >
                  {t('card.tryRun')}
                </Button>
                <Button
                  type="button"
                  className={workflowDetailModalPrimaryActionClass}
                  onClick={() => {
                    onInstall?.();
                    toast.success(t('toast.installed', { name: card.name }));
                    onClose();
                  }}
                >
                  <Download className="mr-1.5 hidden h-4 w-4" aria-hidden />
                  {t('card.goCreate')}
                </Button>
              </>
            ) : mode === 'draft' ? (
              <>
                <Button
                  type="button"
                  className={workflowDetailModalPrimaryActionClass}
                  onClick={onEdit}
                >
                  {t('detail.continueEdit')}
                </Button>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  className={workflowDetailModalSecondaryActionClass}
                  onClick={onEdit}
                >
                  <LayoutGrid className="mr-1.5 hidden h-4 w-4" aria-hidden />
                  {t('card.edit')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  className={cn(workflowDetailModalPrimaryActionClass, 'order-4')}
                  onClick={onRun}
                >
                  <Play className="mr-1.5 hidden h-4 w-4" aria-hidden />
                  {t('detail.runNow')}
                </Button>
                <span className="order-2 flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  className={cn(workflowDetailModalSecondaryActionClass, 'order-3')}
                  onClick={onEdit}
                >
                  <LayoutGrid className="mr-1.5 hidden h-4 w-4" aria-hidden />
                  {t('card.edit')}
                </Button>
                <div className="order-1">
                  <Button
                    type="button"
                    variant="outline"
                    className={workflowDetailModalMoreActionClass}
                    aria-label={t('card.more')}
                    aria-expanded={moreOpen}
                    onClick={openMoreMenu}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>

        {moreOpen && mode === 'installed' ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[125] cursor-default bg-transparent"
              aria-label={t('card.more')}
              onClick={() => setMoreOpen(false)}
            />
            <div
              className={cn(workflowListCardMenuClass, 'fixed')}
              // 锚点坐标来自 getBoundingClientRect，只能用 style 注入（与列表卡片菜单一致）
              style={{
                left: moreMenuPos.x,
                top: moreMenuPos.y,
                transform: 'translateY(-100%)',
              }}
              role="menu"
            >
              {mine ? (
                <button
                  type="button"
                  role="menuitem"
                  className={workflowListCardMenuItemClass}
                  onClick={() => {
                    setMoreOpen(false);
                    onToggleSchedule?.();
                  }}
                >
                  {card.enabled ? (
                    <Pause className="h-4 w-4 text-muted-foreground" aria-hidden />
                  ) : (
                    <Play className="h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                  {card.enabled ? t('card.pauseSchedule') : t('card.resumeSchedule')}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={workflowListCardMenuItemClass}
                onClick={() => {
                  setMoreOpen(false);
                  onRename?.();
                }}
              >
                {t('card.rename')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={workflowListCardMenuItemClass}
                onClick={() => {
                  setMoreOpen(false);
                  onShare?.();
                }}
              >
                <Share2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('card.share')}
              </button>
              <div className="mx-2 my-1.5 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                className={cn(workflowListCardMenuItemClass, 'text-destructive hover:bg-destructive/10')}
                onClick={() => {
                  setMoreOpen(false);
                  onDelete?.();
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {t('card.delete')}
              </button>
            </div>
          </>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
