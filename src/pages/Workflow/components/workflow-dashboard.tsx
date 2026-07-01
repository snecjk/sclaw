import { useRef, useState, useCallback } from 'react';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  stoMainInnerShell,
  workflowHeroInteractiveShellClass,
  workflowHeroManualCreateClass,
  workflowHeroQuickChipClass,
  workflowHeroQuickPromptsRowClass,
  workflowHeroSectionClass,
  workflowHeroTitleClass,
  workflowListSearchIconWrapClass,
  workflowListSearchInputClass,
  workflowListSearchLabelClass,
  workflowListSubnavClass,
  workflowListSubnavCountClass,
  workflowListSubnavNavClass,
  workflowListSubnavSlotClass,
  workflowListTabClass,
  workflowListCardMenuClass,
  workflowListCardMenuItemClass,
  workflowListMainSectionClass,
  workflowListToolbarClass,
} from '@/lib/surfaces';
import { WorkflowDeleteConfirm } from '@/pages/Workflow/components/workflow-delete-confirm';
// TODO: 预览/详情弹窗暂不启用
// import {
//   WorkflowDetailModal,
//   type WorkflowDetailMode,
// } from '@/pages/Workflow/components/workflow-detail-modal';
import {
  WorkflowListCardGrid,
  WorkflowMineListCard,
  WorkflowOfficialListCard,
} from '@/pages/Workflow/components/workflow-list-card';
import { EXAMPLE_CHIPS } from '@/pages/Workflow/constants';
import type {
  // TODO: 预览/详情弹窗暂不启用
  // OfficialWorkflowCard,
  WorkflowCardItem,
  WorkflowMineListKind,
} from '@/pages/Workflow/types';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useWorkflowList } from '@/pages/Workflow/use-workflow-list';
import { renameWorkflow, deleteWorkflow } from '@/lib/workflow-api';
import { navigateToNewSessionWithPrompt } from '@/lib/main-chat-navigation';
import { WorkflowComposer } from '@/pages/Workflow/components/workflow-composer';

interface WorkflowDashboardProps {
  onManualCreate: () => void;
  onGenerate: (prompt: string) => void;
  onEditCard: (workflowId: string) => void;
}

type MineFilter = WorkflowMineListKind;
type OfficialFilter = 'all' | string;

/** 工作流列表页主面板：Hero 生成区 + Tab 切换（我的/官方） + 卡片网格 + 右键菜单 + 详情弹窗 */
export function WorkflowDashboard({
  onManualCreate,
  onGenerate,
  onEditCard,
}: WorkflowDashboardProps) {
  const { t } = useTranslation('workflow');
  const navigate = useNavigate();
  const location = useLocation();
  const { cards, mineLoading, officialLoading, error, refetchMine, officialCards } =
    useWorkflowList();
  /** chip 点击后 bump key，使 ChatInput 重挂载并应用 seedText */
  const [composerSeed, setComposerSeed] = useState<{ text: string; key: number } | null>(null);
  const [tab, setTab] = useState<'mine' | 'official'>('mine');
  const [search, setSearch] = useState('');
  const [mineFilter, setMineFilter] = useState<MineFilter>('published');
  const [officialFilter, setOfficialFilter] = useState<OfficialFilter>('all');
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const renameRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // TODO: 预览/详情弹窗暂不启用，相关逻辑先注释
  // const [detailOpen, setDetailOpen] = useState(false);
  // const [detailMode, setDetailMode] = useState<WorkflowDetailMode>('installed');
  // const [detailMineCard, setDetailMineCard] = useState<WorkflowCardItem | null>(null);
  // const [detailOfficialCard, setDetailOfficialCard] = useState<OfficialWorkflowCard | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowCardItem | null>(null);

  /** 快捷提示词 i18n label 映射 */
  const chipLabels: Record<(typeof EXAMPLE_CHIPS)[number], string> = {
    weeklyReconciliation: t('generate.chipWeekly'),
    abnormalCustomer: t('generate.chipAbnormal'),
    dailyRevenue: t('generate.chipDaily'),
  };

  /** 从官方卡片中提取分类列表（含 'all'） */
  const officialCategories = (() => {
    const cats = new Set(officialCards.map((c) => c.category).filter(Boolean));
    return ['all', ...Array.from(cats)];
  })();

  /** 我的工作流各分类搜索后数量统计 */
  const mineSearchCounts: Record<WorkflowMineListKind, number> = (() => {
    const q = search.trim().toLowerCase();
    return {
      published: cards.filter(
        (c) => c.listKind === 'published' && (!q || c.name.toLowerCase().includes(q))
      ).length,
      draft: cards.filter((c) => c.listKind === 'draft' && (!q || c.name.toLowerCase().includes(q)))
        .length,
    };
  })();

  /** 官方推荐各分类搜索后数量统计（显示搜索后当前分类有多少条） */
  const officialSearchCounts: Record<string, number> = (() => {
    const q = search.trim().toLowerCase();
    const map: Record<string, number> = {};
    officialCategories.forEach((cat) => {
      const base = cat === 'all' ? officialCards : officialCards.filter((c) => c.category === cat);
      const filtered = q ? base.filter((c) => c.name.toLowerCase().includes(q)) : base;
      map[cat] = filtered.length;
    });
    return map;
  })();

  /** 我的工作流：先按 listKind 筛选当前分类，再在分类下按名称搜索 */
  const filteredMine = (() => {
    let list = cards.filter((c) => c.listKind === mineFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  })();

  /** 官方推荐：先按分类筛选，再在分类下按名称搜索 */
  const filteredOfficial = (() => {
    let list = officialCards;
    if (officialFilter !== 'all') list = list.filter((c) => c.category === officialFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  })();

  const openMenu = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuIndex(index);
    setMenuPos({
      x: Math.max(8, rect.right - 200),
      y: Math.min(rect.bottom + 6, window.innerHeight - 230),
    });
  };

  const closeMenu = () => setMenuIndex(null);

  /** 立即运行：按标题复用已有会话，否则新建并命名，再跳转首页自动发送。 */
  const runWorkflowInChat = useCallback(
    (card: Pick<WorkflowCardItem, 'id' | 'name'>) => {
      navigateToNewSessionWithPrompt(
        navigate,
        location.pathname,
        `帮我执行 id 为：${card.id} 的工作流 【${card.name}】`,
        { sessionTitle: `执行${card.name}工作流` }
      );
    },
    [navigate, location.pathname]
  );

  // TODO: 预览/详情弹窗暂不启用 — updateCard 仅在详情弹窗 onToggleSchedule 中使用
  // const updateCard = (index: number, patch: Partial<WorkflowCardItem>) => {
  //   setCards(cards.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  // };

  // TODO: 预览/详情弹窗暂不启用
  // const openDetailForMine = (card: WorkflowCardItem) => {
  //   setDetailMode('installed');
  //   setDetailMineCard(card);
  //   setDetailOfficialCard(null);
  //   setDetailOpen(true);
  // };

  // TODO: 预览/详情弹窗暂不启用
  // const openDetailForOfficial = (card: OfficialWorkflowCard) => {
  //   setDetailMode('preview');
  //   setDetailOfficialCard(card);
  //   setDetailMineCard(null);
  //   setDetailOpen(true);
  // };

  // TODO: 预览/详情弹窗暂不启用
  // const closeDetail = () => {
  //   setDetailOpen(false);
  //   setDetailMineCard(null);
  //   setDetailOfficialCard(null);
  // };

  // TODO: 预览/详情弹窗暂不启用
  // const detailCard = detailMineCard ?? detailOfficialCard;
  // /** 详情数据暂为 null（待接入详情 API），弹窗已有 null fallback */
  // const detailData = null;

  // TODO: 预览/详情弹窗暂不启用
  // const handleShare = () => {
  //   toast.success(t('toast.shared'));
  // };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteWorkflow(deleteTarget.id);
      toast.success(t('toast.deleted', { name: deleteTarget.name }));
      setDeleteTarget(null);
      // closeDetail();
      await refetchMine();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className={cn(stoMainInnerShell, 'pb-10')}>
      <header className="sr-only">
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </header>

      {/* 一句话生成：标题 + 输入复合框 + 快捷提示 */}
      <section className={workflowHeroSectionClass} aria-labelledby="workflow-hero-heading">
        <h2 id="workflow-hero-heading" className={workflowHeroTitleClass}>
          {t('generate.title')}
        </h2>
        <div className={workflowHeroInteractiveShellClass}>
          <WorkflowComposer
            key={composerSeed?.key ?? 'workflow-composer'}
            seedText={composerSeed?.text}
            onGenerate={onGenerate}
          />
          <div className={workflowHeroQuickPromptsRowClass}>
            <div
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="group"
              aria-label={t('generate.quickPromptsAria')}
            >
              {EXAMPLE_CHIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setComposerSeed({ text: chipLabels[key], key: Date.now() })}
                  className={workflowHeroQuickChipClass}
                >
                  {chipLabels[key]}
                </button>
              ))}
            </div>
            <div className="relative ml-2 shrink-0">
              <div
                className="pointer-events-none absolute right-full top-0 z-[1] h-full w-10 bg-gradient-to-r from-transparent to-background dark:to-[hsl(var(--card))]"
                aria-hidden
              />
              <button
                type="button"
                onClick={onManualCreate}
                className={workflowHeroManualCreateClass}
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                <span className="shrink-0 whitespace-nowrap">{t('generate.manualCreate')}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Tab + 二级筛选 + 列表：与快捷提示行间距 64px，整块联动 */}
      <div className={workflowListMainSectionClass}>
        <div className={workflowListToolbarClass}>
          <div
            className="flex shrink-0 items-center gap-5"
            role="tablist"
            aria-label={t('tabs.aria')}
          >
            {(['mine', 'official'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key);
                }}
                className={workflowListTabClass(tab === key)}
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
          <label className={workflowListSearchLabelClass}>
            <span className="sr-only">{t('searchPlaceholder')}</span>
            <span className={workflowListSearchIconWrapClass} aria-hidden="true">
              <Search className="h-3.5 w-3.5" />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearch('');
                }
              }}
              className={workflowListSearchInputClass}
              placeholder={t('searchPlaceholder')}
              autoComplete="off"
            />
          </label>
        </div>

        {/* 我的工作流 */}
        <section role="tabpanel" aria-label={t('tabs.mine')} hidden={tab !== 'mine'}>
          <div className={workflowListSubnavSlotClass}>
            <nav className={workflowListSubnavNavClass} aria-label={t('filter.aria')}>
              {(['published', 'draft'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-selected={mineFilter === key}
                  onClick={() => setMineFilter(key)}
                  className={cn(
                    workflowListSubnavClass(mineFilter === key),
                    'shrink-0 whitespace-nowrap'
                  )}
                >
                  <span>{t(`filter.${key}`)}</span>
                  <span className={workflowListSubnavCountClass(mineFilter === key)}>
                    {mineSearchCounts[key]}
                  </span>
                </button>
              ))}
            </nav>
          </div>

          {mineLoading ? (
            <div className="flex justify-center py-16" aria-busy="true">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void refetchMine();
                }}
              >
                {t('list.retry')}
              </Button>
            </div>
          ) : filteredMine.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-[15px] font-medium text-foreground/80">
                {t('list.empty')}
              </p>
              {mineFilter === 'draft' ? (
                <Button type="button" variant="outline" onClick={onManualCreate}>
                  {t('generate.manualCreate')}
                </Button>
              ) : null}
            </div>
          ) : (
            <WorkflowListCardGrid>
              {filteredMine.map((card) => {
                const index = cards.findIndex((c) => c.id === card.id);
                return (
                  <WorkflowMineListCard
                    key={card.id}
                    card={card}
                    isRenaming={renamingId === card.id}
                    renameRef={renameRef}
                    onRenameCommit={async (name) => {
                      setRenameLoading(true);
                      try {
                        await renameWorkflow(card.id, name);
                        setRenamingId(null);
                        toast.success(t('toast.renamed'));
                        await refetchMine();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : '重命名失败');
                      } finally {
                        setRenameLoading(false);
                      }
                    }}
                    // TODO: 等待后端 API 对接 — onToggleEnabled 暂不启用
                    // onToggleEnabled={(on) => {
                    //   updateCard(index, { enabled: on, showPausedLabel: !on });
                    //   toast.success(on ? t('toast.resumed') : t('toast.paused'));
                    // }}
                    // TODO: 等待后端 API 对接 — onCardClick 暂不启用
                    // onCardClick={() => openDetailForMine(card)}
                    onRun={() => runWorkflowInChat(card)}
                    onEdit={() => onEditCard(card.id)}
                    onMore={(e) => openMenu(e, index)}
                  />
                );
              })}
            </WorkflowListCardGrid>
          )}
        </section>

        <section role="tabpanel" aria-label={t('tabs.official')} hidden={tab !== 'official'}>
          {officialLoading ? (
            <div className="flex justify-center py-16" aria-busy="true">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <>
              <div className={workflowListSubnavSlotClass}>
                <nav className={workflowListSubnavNavClass} aria-label={t('officialFilter.aria')}>
                  {officialCategories.map((cat) => {
                    const key = cat === 'all' ? 'all' : cat;
                    const label = cat === 'all' ? t('filter.all') : cat;
                    const isActive = officialFilter === key;
                    return (
                      <button
                        key={cat}
                        type="button"
                        aria-selected={isActive}
                        onClick={() => setOfficialFilter(key)}
                        className={cn(
                          workflowListSubnavClass(isActive),
                          'shrink-0 whitespace-nowrap'
                        )}
                      >
                        <span>{label}</span>
                        <span className={workflowListSubnavCountClass(isActive)}>
                          {officialSearchCounts[cat] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <WorkflowListCardGrid>
                {filteredOfficial.map((card) => (
                  <WorkflowOfficialListCard
                    key={card.id}
                    card={card}
                    // TODO: 点击详情弹窗暂不启用
                    // onCardClick={() => openDetailForOfficial(card)}
                    // onPreview={() => openDetailForOfficial(card)}
                    onInstall={() => {
                      const q = encodeURIComponent(`/${card.name}`);
                      const wid = encodeURIComponent(card.id);
                      navigate(`/?q=${q}&workflowId=${wid}`);
                    }}
                  />
                ))}
              </WorkflowListCardGrid>
            </>
          )}
        </section>
      </div>

      {menuIndex !== null ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[125] cursor-default bg-transparent"
            aria-label={t('card.more')}
            onClick={closeMenu}
          />
          <div
            className={workflowListCardMenuClass}
            style={{ left: menuPos.x, top: menuPos.y }}
            role="menu"
          >
            {/* <button
              type="button"
              role="menuitem"
              className={workflowListCardMenuItemClass}
              onClick={() => {
                const c = cards[menuIndex];
                if (!c) return;
                updateCard(menuIndex, { enabled: !c.enabled, showPausedLabel: c.enabled });
                toast.success(c.enabled ? t('toast.paused') : t('toast.resumed'));
                closeMenu();
              }}
            >
              {cards[menuIndex]?.enabled ? t('card.pauseSchedule') : t('card.resumeSchedule')}
            </button> */}
            <button
              type="button"
              role="menuitem"
              className={workflowListCardMenuItemClass}
              disabled={renameLoading}
              onClick={() => {
                const c = cards[menuIndex];
                if (!c) return;
                setRenamingId(c.id);
                closeMenu();
                requestAnimationFrame(() => renameRef.current?.focus());
              }}
            >
              {t('card.rename')}
            </button>
            {/* <button
              type="button"
              role="menuitem"
              className={workflowListCardMenuItemClass}
              onClick={() => {
                const c = cards[menuIndex];
                if (c) handleShare();
                closeMenu();
              }}
            >
              {t('card.share')}
            </button> */}
            <div className="mx-2 my-1.5 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              className={cn(
                workflowListCardMenuItemClass,
                'text-destructive hover:bg-destructive/10'
              )}
              disabled={deleteLoading}
              onClick={() => {
                const c = cards[menuIndex];
                if (!c) return;
                setDeleteTarget(c);
                closeMenu();
              }}
            >
              {t('card.delete')}
            </button>
          </div>
        </>
      ) : null}

      {/* TODO: 预览/详情弹窗暂不启用 */}
      {/* <WorkflowDetailModal
        open={detailOpen}
        mode={detailMode}
        card={detailCard}
        detail={detailData}
        onClose={closeDetail}
        onRun={() => {
          if (!detailMineCard) return;
          closeDetail();
          runWorkflowInChat(detailMineCard);
        }}
        onEdit={() => {
          if (detailMineCard) {
            closeDetail();
            onEditCard(detailMineCard.id);
          }
        }}
        onTryRun={() => toast.info(t('detail.tryRunHint'))}
        onToggleSchedule={() => {
          if (!detailMineCard) return;
          const idx = cards.findIndex((c) => c.id === detailMineCard.id);
          if (idx < 0) return;
          const next = !detailMineCard.enabled;
          updateCard(idx, { enabled: next, showPausedLabel: !next });
          setDetailMineCard({ ...detailMineCard, enabled: next, showPausedLabel: !next });
          toast.success(next ? t('toast.resumed') : t('toast.paused'));
        }}
        onRename={() => {
          if (!detailMineCard) return;
          setRenamingId(detailMineCard.id);
          closeDetail();
          requestAnimationFrame(() => renameRef.current?.focus());
        }}
        onShare={() => {
          if (detailMineCard) handleShare();
        }}
        onDelete={() => {
          if (detailMineCard) setDeleteTarget(detailMineCard);
        }}
      /> */}

      <WorkflowDeleteConfirm
        open={deleteTarget !== null}
        workflowName={deleteTarget?.name ?? ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
