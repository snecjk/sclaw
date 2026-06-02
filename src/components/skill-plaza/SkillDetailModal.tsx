import { useNavigate } from 'react-router-dom';
import { X, Play, Download, Users, ArrowDownToLine } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SkillDetailModalProps {
  skill: SkillSummary | null;
  open: boolean;
  onClose: () => void;
}

export function SkillDetailModal({ skill, open, onClose }: SkillDetailModalProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const { installing, plazaSkills, mySkills } = useSkillPlazaStore();

  // Use live skill data from store so the modal reflects install/uninstall changes immediately
  const liveSkill = skill
    ? ([...plazaSkills, ...mySkills].find((s) => s.slug === skill.slug) ?? skill)
    : null;
  const isInstalling = liveSkill ? installing[liveSkill.slug] : false;

  if (!liveSkill) return null;

  const handleUse = () => {
    const prompt = encodeURIComponent(liveSkill.defaultPrompt || liveSkill.title);
    onClose();
    navigate(`/?q=${prompt}`);
    // Fire-and-forget use record
    useSkillPlazaStore.getState().useSkill(liveSkill.slug).catch(() => {});
  };

  const handleInstall = () => {
    const { installSkill, fetchPlazaSkills } = useSkillPlazaStore.getState();
    installSkill(liveSkill.slug).then(() => fetchPlazaSkills({ reset: true })).catch(() => {});
  };

  const tag = liveSkill.installed
    ? { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: '#DCF5E2', text: '#00B54B' }
    : liveSkill.source === 'mine'
      ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: '#FFF5E6', text: '#D95700' }
      : { label: t('plaza.tag.official', { defaultValue: '官方' }), bg: '#F0F4FF', text: '#4760FE' };

  const renderIcon = () => {
    if (liveSkill.icon) {
      return (
        <span
          dangerouslySetInnerHTML={{ __html: liveSkill.icon.replace(/width="[^"]*"/, 'width="20"').replace(/height="[^"]*"/, 'height="20"') }}
        />
      );
    }
    return <span className="text-lg">📦</span>;
  };

  // Optional workflow steps from skill data (future backend support)
  const workflowSteps = (liveSkill as unknown as Record<string, unknown>).workflowSteps as string[] | undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-[440px] max-h-[85vh]',
            'bg-background rounded-2xl shadow-2xl',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          )}
        >
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className="p-5 pb-4">
              {/* Close button */}
              <Dialog.Close asChild>
                <button
                  onClick={onClose}
                  className="absolute right-4 top-4 h-7 w-7 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Dialog.Close>

              <div className="flex items-start gap-3 pr-8">
                <div className="relative w-10 h-10 rounded-lg flex items-center justify-center bg-background flex-shrink-0 border border-border"
                  style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}>
                  {renderIcon()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">{liveSkill.title}</h2>
                    <span
                      className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: tag.bg, color: tag.text }}
                    >
                      {tag.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-muted-foreground mt-1">
                    {typeof liveSkill.useCount === 'number' && liveSkill.useCount >= 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3 opacity-55" />
                        {liveSkill.useCount >= 1000 ? `${(liveSkill.useCount / 1000).toFixed(1)}k` : liveSkill.useCount}
                      </span>
                    )}
                    {typeof liveSkill.installCount === 'number' && liveSkill.installCount >= 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ArrowDownToLine className="h-3 w-3 opacity-55" />
                        {liveSkill.installCount >= 1000 ? `${(liveSkill.installCount / 1000).toFixed(1)}k` : liveSkill.installCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 技能描述 */}
            <div className="p-5 py-4">
              <h3 className="text-xs text-muted-foreground mb-2">
                {t('plaza.detail.skillDesc', { defaultValue: '技能描述' })}
              </h3>
              <p className="text-sm text-foreground leading-relaxed">
                {liveSkill.description}
              </p>
            </div>

            {/* 流程步骤 */}
            {workflowSteps && workflowSteps.length > 0 && (
              <>
                <div className="border-t border-border" />
                <div className="p-5 py-4">
                  <h3 className="text-xs text-muted-foreground mb-3">
                    {t('plaza.detail.workflowSteps', { defaultValue: '流程步骤' })}
                  </h3>
                  <ol className="space-y-2">
                    {workflowSteps.map((step, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs text-muted-foreground flex-shrink-0 mt-0.5">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}

            {/* 数据概览 */}
            {liveSkill.points !== null && (
              <>
                <div className="border-t border-border" />
                <div className="p-5 py-4">
                  <h3 className="text-xs text-muted-foreground mb-2">
                    {t('plaza.detail.dataOverview', { defaultValue: '数据概览' })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('plaza.detail.usageEstimate', { count: liveSkill.points, defaultValue: `使用 1 次技能，预计消耗 ${liveSkill.points} 积分` })}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* CTA */}
          <div className="p-4 bg-background">
            {liveSkill.installed || liveSkill.source === 'mine' ? (
              <button
                onClick={handleUse}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
              >
                <Play className="h-4 w-4" />
                {t('plaza.action.useNow', { defaultValue: '立即使用' })}
              </button>
            ) : (
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isInstalling ? (
                  <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t('plaza.action.install', { defaultValue: '安装' })}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
