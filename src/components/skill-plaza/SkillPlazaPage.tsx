import { useEffect, useState, useCallback } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SkillPlazaHeader } from './SkillPlazaHeader';
import { SkillPlazaToolbar } from './SkillPlazaToolbar';
import { SkillPlazaCategoryNav } from './SkillPlazaCategoryNav';
import { SkillCard } from './SkillCard';
import { SkillCardList } from './SkillCardList';
import { SkillDetailModal } from './SkillDetailModal';
import type { SkillSummary } from '@/types/skill-plaza';
import { cn } from '@/lib/utils';

export function SkillPlazaPage() {
  const { t } = useTranslation('skills');
  const {
    activeTab,
    activeCategory,
    searchQuery,
    plazaSkills,
    mySkills,
    loading,
    viewMode,

    fetchCategories,
    fetchPlazaSkills,
    fetchLocalSkills,
    uninstallSkill,
  } = useSkillPlazaStore();

  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);

  // Initial load: reset category to 'all' when page mounts
  useEffect(() => {
    useSkillPlazaStore.setState({ activeCategory: '' });
    fetchCategories();
    fetchPlazaSkills({ reset: true });
  }, [fetchCategories, fetchPlazaSkills]);

  // Tab switch data loading
  useEffect(() => {
    if (activeTab === 'mine') {
      fetchLocalSkills();
    }
  }, [activeTab, fetchLocalSkills]);

  const rawSkills = activeTab === 'all'
    ? plazaSkills
    : activeCategory
      ? mySkills.filter((s) => s.categoryCode === activeCategory)
      : mySkills;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const skills = normalizedQuery
    ? rawSkills.filter((s) =>
        s.title.toLowerCase().includes(normalizedQuery) ||
        s.description?.toLowerCase().includes(normalizedQuery)
      )
    : rawSkills;
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

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <SkillPlazaHeader />
      <SkillPlazaToolbar />
      <SkillPlazaCategoryNav />

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && skills.length === 0 ? (
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
          <div className="flex flex-col border border-border rounded-[14px] bg-background overflow-hidden">
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
          /* Grid view (default for plaza tab, grid for mine tab) */
          <div
            className={cn(
              'grid gap-3',
              'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
            )}
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
    </div>
  );
}
