import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Package, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SkillPlazaHeader, type SkillPlazaSection } from './SkillPlazaHeader';
import { SkillPlazaCategoryNav } from './SkillPlazaCategoryNav';
import { SkillCard } from './SkillCard';
import { SkillCardList } from './SkillCardList';
import { SkillDetailModal } from './SkillDetailModal';
import { ConnectorPanel } from '@/components/connectors/ConnectorPanel';
import type { SkillSummary } from '@/types/skill-plaza';
import { cn } from '@/lib/utils';
import { stoMainInnerShell } from '@/lib/surfaces';
import {
  normalizeMineCategoryBucket,
  resolveMineSkillCategoryCode,
} from '@/lib/skill-plaza-category';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { SidebarHeaderToggle } from '@/components/layout/sidebar-header-toggle';

/** 动态列数：单卡≥240px，最多 4 列（gap-3 = 0.75rem × 3） */
const SKILL_PLAZA_GRID_STYLE = {
  gridTemplateColumns:
    'repeat(auto-fill, minmax(min(100%, max(240px, calc((100% - 2.25rem) / 4))), 1fr))',
} as const;

export function SkillPlazaPage() {
  const { t } = useTranslation('skills');
  const { t: tCommon } = useTranslation('common');
  const { snapshot, setUserCollapsed } = useAppShellLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const [plazaSection, setPlazaSection] = useState<SkillPlazaSection>(
    sectionParam === 'connectors' ? 'connectors' : 'skills',
  );

  useEffect(() => {
    if (sectionParam === 'connectors') {
      setPlazaSection('connectors');
    } else if (sectionParam === 'skills' || sectionParam == null) {
      // Keep connectors when user toggled in-page without clearing URL only if param says connectors.
      if (sectionParam === 'skills') setPlazaSection('skills');
    }
  }, [sectionParam]);

  const handleSectionChange = useCallback((section: SkillPlazaSection) => {
    setPlazaSection(section);
    if (section === 'connectors') {
      setSearchParams({ section: 'connectors' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [setSearchParams]);
  // Subscribe (shallow) only to the render-relevant slice so churny state like
  // installing/uninstalling flags does not re-render the whole page.
  const {
    activeTab,
    activeCategory,
    searchQuery,
    plazaSkills,
    mySkills,
    categories,
    plazaSkillMetaMap,
    loading,
    syncingUserSkills,
    awaitingAuth,
    viewMode,
  } = useSkillPlazaStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      activeCategory: s.activeCategory,
      searchQuery: s.searchQuery,
      plazaSkills: s.plazaSkills,
      mySkills: s.mySkills,
      categories: s.categories,
      plazaSkillMetaMap: s.plazaSkillMetaMap,
      loading: s.loading,
      syncingUserSkills: s.syncingUserSkills,
      awaitingAuth: s.awaitingAuth,
      viewMode: s.viewMode,
    })),
  );

  // Actions are stable references in the store; select them individually.
  const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);
  const syncUserSkills = useSkillPlazaStore((s) => s.syncUserSkills);
  const uninstallSkill = useSkillPlazaStore((s) => s.uninstallSkill);

  const user = useAuthStore((s) => s.user);
  const isAuthInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Auth (STO token) must be ready before any plaza read; otherwise the backend
  // would return an unfiltered category set. Until then we show a loading state.
  const authReady = isAuthInitialized && isAuthenticated;

  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [showUploadSuccess, setShowUploadSuccess] = useState(false);

  // Initial + user-change load. We wait until auth (STO token) is ready before
  // any plaza read; a read before the token exists would return an unfiltered
  // category set. While not ready the page stays in a loading state, and the
  // store's own retry loop recovers if the token arrives slightly late.
  useEffect(() => {
    if (!authReady) return;
    useSkillPlazaStore.setState({ activeCategory: '' });
    void syncUserSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user?.code]);

  // Lazily load "我的技能" the first time its tab is viewed (or after an
  // account switch marked it stale). setActiveTab also triggers this; the
  // store dedups concurrent calls.
  useEffect(() => {
    if (authReady && activeTab === 'mine' && mySkills.length === 0) {
      fetchLocalSkills();
    }
  }, [authReady, activeTab, mySkills.length, fetchLocalSkills]);

  // Index plaza skills by slug so mine-tab category resolution is O(1) per skill
  // instead of a linear scan inside a filter (O(n*m)).
  const plazaBySlug = useMemo(() => {
    const map = new Map<string, SkillSummary>();
    for (const p of plazaSkills) map.set(p.slug, p);
    return map;
  }, [plazaSkills]);

  const resolveMineCategoryCode = useCallback(
    (skill: SkillSummary) => {
      const plazaSkill = plazaBySlug.get(skill.slug);
      return normalizeMineCategoryBucket(
        resolveMineSkillCategoryCode(skill, categories, plazaSkillMetaMap, plazaSkill),
        categories,
      );
    },
    [plazaBySlug, categories, plazaSkillMetaMap],
  );

  const skills = useMemo(() => {
    const rawSkills = activeTab === 'all'
      ? plazaSkills
      : activeCategory
        ? mySkills.filter((s) => resolveMineCategoryCode(s) === activeCategory)
        : mySkills;

    if (activeTab === 'all') return rawSkills;

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return rawSkills;
    return rawSkills.filter((s) =>
      s.title.toLowerCase().includes(normalizedQuery) ||
      s.description?.toLowerCase().includes(normalizedQuery),
    );
  }, [activeTab, activeCategory, plazaSkills, mySkills, searchQuery, resolveMineCategoryCode]);

  const isMine = activeTab === 'mine';
  const isGrid = viewMode === 'grid';

  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success(t('plaza.toast.uninstallSuccess', { defaultValue: '已删除' }));
    } catch (err) {
      toast.error(t('plaza.toast.uninstallError', { defaultValue: '删除失败' }), {
        description: String(err),
      });
    }
  }, [uninstallSkill, t]);

  const handleUploadSuccess = useCallback(() => {
    setShowUploadSuccess(true);
    window.setTimeout(() => setShowUploadSuccess(false), 1800);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6">
      {snapshot.canUserRestoreSidebar ? (
        <SidebarHeaderToggle
          isCollapsed
          onToggle={() => setUserCollapsed(false)}
          collapseLabel={tCommon('sidebar.toggleSidebarCollapse')}
          expandLabel={tCommon('sidebar.toggleSidebarExpand')}
          className="absolute left-[calc(var(--sto-content-header-pad-start)-var(--sto-content-pad-x))] top-2 z-20"
        />
      ) : null}
      {showUploadSuccess && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-50 -translate-x-1/2">
          <div className="inline-flex items-center gap-2 rounded-md bg-[#00B54B] px-4 py-2 text-sm font-semibold text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 text-white" />
            <span>{t('plaza.upload.successTitle', { defaultValue: '安装成功' })}</span>
          </div>
        </div>
      )}
        <div className={cn(stoMainInnerShell, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <SkillPlazaHeader
        section={plazaSection}
        onSectionChange={handleSectionChange}
        onUploadSuccess={handleUploadSuccess}
      />

      {plazaSection === 'connectors' ? (
        <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ConnectorPanel />
        </div>
      ) : (
        <>
      <SkillPlazaCategoryNav />

      {/* Skill list */}
      <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {syncingUserSkills && skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="h-8 w-8 mb-4 animate-spin opacity-50" />
            <p>{t('plaza.syncingUserSkills', { defaultValue: '正在同步您的技能…' })}</p>
          </div>
        ) : (!authReady || awaitingAuth || loading) && skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="h-8 w-8 mb-4 animate-spin opacity-50" />
            <p>{t('plaza.loading', { defaultValue: '加载中...' })}</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Package className="h-10 w-10 mb-4 opacity-50" />
            <p>{t('plaza.noSkills', { defaultValue: '暂无可用技能' })}</p>
          </div>
        ) : isMine && !isGrid ? (
          /* List view for mine tab */
          <div className="flex flex-col border border-border rounded-[14px] bg-white dark:bg-background overflow-hidden">
            {skills.map((skill) => (
              <SkillCardList
                key={skill.slug}
                skill={skill}
                onOpenDetail={setSelectedSkill}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={SKILL_PLAZA_GRID_STYLE}
          >
            {skills.map((skill) => (
              <SkillCard
                key={skill.slug}
                skill={skill}
                onOpenDetail={setSelectedSkill}
                onDelete={setDeleteTarget}
                isMineTab={isMine}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <SkillDetailModal
        skill={selectedSkill}
        open={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('plaza.deleteConfirm.title', { defaultValue: '删除技能' })}
        message={t('plaza.deleteConfirm.message', {
          defaultValue: '确定要删除该技能吗？删除后将从「我的技能」中移除。',
        })}
        confirmLabel={t('plaza.deleteConfirm.confirm', { defaultValue: '删除' })}
        cancelLabel={t('plaza.deleteConfirm.cancel', { defaultValue: '取消' })}
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) {
            await handleUninstall(deleteTarget.slug);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
        </>
      )}
        </div>
      </div>
    </div>
  );
}
