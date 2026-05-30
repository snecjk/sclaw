import { useNavigate } from 'react-router-dom';
import { X, Play, Download } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';

interface SkillDetailModalProps {
  skill: SkillSummary | null;
  open: boolean;
  onClose: () => void;
}

export function SkillDetailModal({ skill, open, onClose }: SkillDetailModalProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const { installing } = useSkillPlazaStore();
  const isInstalling = skill ? installing[skill.slug] : false;

  if (!skill) return null;

  const handleUse = () => {
    const prompt = encodeURIComponent(skill.defaultPrompt || skill.title);
    onClose();
    navigate(`/conversation?q=${prompt}`);
    // Fire-and-forget use record
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const handleInstall = () => {
    const { installSkill, fetchPlazaSkills } = useSkillPlazaStore.getState();
    installSkill(skill.slug).then(() => fetchPlazaSkills({ reset: true })).catch(() => {});
  };

  const tag = skill.installed
    ? { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: '#DCF5E2', text: '#00B54B' }
    : skill.source === 'mine'
      ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: '#FFF5E6', text: '#D95700' }
      : { label: t('plaza.tag.official', { defaultValue: '官方' }), bg: '#F0F4FF', text: '#4760FE' };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <div
          className="w-16 h-16"
          dangerouslySetInnerHTML={{ __html: skill.icon }}
        />
      );
    }
    return (
      <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
        <span className="text-2xl">📦</span>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Hero */}
          <div className="flex items-start gap-4 mb-6 mt-2">
            {renderIcon()}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-foreground">{skill.title}</h2>
              </div>
              <span
                className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: tag.bg, color: tag.text }}
              >
                {tag.label}
              </span>
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-6">
            {typeof skill.installCount === 'number' && skill.installCount > 0 && (
              <span>{t('plaza.meta.installs', { count: skill.installCount, defaultValue: `${skill.installCount} 安装` })}</span>
            )}
            {typeof skill.useCount === 'number' && skill.useCount > 0 && (
              <span>{t('plaza.meta.uses', { count: skill.useCount, defaultValue: `${skill.useCount} 使用` })}</span>
            )}
            {skill.points !== null && (
              <span className="text-[#FF6F00]">
                {t('plaza.meta.points', { count: skill.points, defaultValue: `预计${skill.points}积分` })}
              </span>
            )}
            {skill.category && (
              <span>{skill.category}</span>
            )}
          </div>

          {/* Intro */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-foreground mb-2">
              {t('plaza.detail.introTitle', { defaultValue: '技能介绍' })}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {skill.description}
            </p>
          </div>

          {/* Default prompt preview */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-foreground mb-2">
              {t('plaza.detail.defaultPromptTitle', { defaultValue: '默认提问' })}
            </h3>
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              {skill.defaultPrompt}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="p-4 border-t border-border bg-card">
          {skill.installed || skill.source === 'mine' ? (
            <button
              onClick={handleUse}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-[#FF6F00] hover:bg-[#D95700] transition-colors"
            >
              <Play className="h-4 w-4" />
              {t('plaza.action.useNow', { defaultValue: '立即使用' })}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-[#FF6F00] hover:bg-[#D95700] transition-colors disabled:opacity-50"
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
      </SheetContent>
    </Sheet>
  );
}
