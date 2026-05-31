import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, ArrowDownToLine } from 'lucide-react';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { Switch } from '@/components/ui/switch';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SkillCardProps {
  skill: SkillSummary;
  onOpenDetail?: (skill: SkillSummary) => void;
  isMineTab?: boolean;
}

export function SkillCard({ skill, onOpenDetail, isMineTab }: SkillCardProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const { installing } = useSkillPlazaStore();
  const [isHovered, setIsHovered] = useState(false);
  const isInstalling = installing[skill.slug];

  const tag = !isMineTab
    ? (skill.installed
      ? { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: 'rgba(34,197,94,0.12)', text: '#15803d' }
      : { label: t('plaza.tag.official', { defaultValue: '官方' }), bg: 'rgba(59,130,246,0.1)', text: '#2563eb' })
    : skill.source === 'mine'
      ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: 'rgba(249,115,22,0.12)', text: '#ff6700' }
      : { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: 'rgba(34,197,94,0.12)', text: '#15803d' };

  const handleUse = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prompt = encodeURIComponent(skill.defaultPrompt || skill.title);
    navigate(`/?q=${prompt}`);
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    const { installSkill, fetchPlazaSkills } = useSkillPlazaStore.getState();
    installSkill(skill.slug).then(() => fetchPlazaSkills({ reset: true })).catch(() => {});
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <span
          className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-[#2b2b2b] flex-shrink-0 border border-black/[0.06]"
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
        >
          <span dangerouslySetInnerHTML={{ __html: skill.icon.replace(/width="[^"]*"/, 'width="16"').replace(/height="[^"]*"/, 'height="16"') }} />
        </span>
      );
    }
    return (
      <span className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-[#2b2b2b] flex-shrink-0 border border-black/[0.06]"
        style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}>
        <span className="text-base">📦</span>
      </span>
    );
  };

  const canUse = isMineTab
    ? (skill.installed || skill.source === 'mine')
    : skill.installed;

  return (
    <article
      className="relative flex flex-col min-w-0 pt-3.5 px-4 pb-3.5 border border-border rounded-xl bg-white cursor-pointer overflow-visible transition-[border-color,box-shadow] duration-150 hover:border-[#dfe2e8] hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenDetail?.(skill)}
      data-skill-installed={canUse}
    >
      {/* Quick actions - top right */}
      {isMineTab ? (
        <div className="absolute top-3.5 right-4 z-[3]">
          <Switch
            checked={skill.enabled ?? false}
            onCheckedChange={(checked) => {
              useSkillPlazaStore.getState().toggleSkill(skill.slug, checked);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('plaza.action.toggle', { defaultValue: '启用/禁用' })}
          />
        </div>
      ) : (
        <div
          className={cn(
            'absolute top-3.5 right-4 z-[3] flex items-center gap-1.5 max-w-[calc(100%-32px)] transition-all duration-150',
            isHovered ? 'opacity-100 visible pointer-events-auto translate-y-0' : 'opacity-0 invisible pointer-events-none -translate-y-0.5',
          )}
        >
          {canUse ? (
            <button
              onClick={handleUse}
              className="inline-flex items-center justify-center h-7 px-3.5 border-none rounded-full bg-[#f1f3f5] text-xs font-semibold text-foreground cursor-pointer whitespace-nowrap no-underline shadow-sm transition-colors hover:bg-[#e8eaed]"
            >
              {t('plaza.action.use', { defaultValue: '使用' })}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="inline-flex items-center justify-center h-7 px-3.5 border-none rounded-full bg-[#f1f3f5] text-xs font-semibold text-foreground cursor-pointer whitespace-nowrap no-underline shadow-sm transition-colors hover:bg-[#e8eaed] disabled:opacity-50"
            >
              {isInstalling ? (
                <span className="animate-spin h-3 w-3 border-2 border-foreground/30 border-t-foreground rounded-full" />
              ) : (
                t('plaza.action.install', { defaultValue: '安装' })
              )}
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0 no-underline text-inherit">
        {/* Top: icon + title + tags */}
        <div className="flex items-start gap-2.5 mb-2 pr-[68px]">
          {renderIcon()}
          <div className="flex flex-col items-start gap-1.5 min-w-0 flex-1">
            <h2 className="m-0 w-full max-w-full text-sm font-bold tracking-tight text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
              {skill.title}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="text-[11px] font-semibold px-1.5 py-[2px] rounded flex-shrink-0 leading-[1.4]"
                style={{ backgroundColor: tag.bg, color: tag.text }}
              >
                {tag.label}
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="m-0 mb-2 flex-1 text-[13px] leading-snug text-muted-foreground line-clamp-2">
          {skill.description}
        </p>

        {/* Meta */}
        <div className="flex items-center justify-between gap-2 mt-auto text-xs text-muted-foreground font-medium">
          <div className="inline-flex items-center gap-2.5 min-w-0">
            {typeof skill.installCount === 'number' && skill.installCount >= 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5 opacity-55 flex-shrink-0" />
                {skill.installCount >= 1000 ? `${(skill.installCount / 1000).toFixed(1)}k` : skill.installCount}
              </span>
            )}
            {typeof skill.useCount === 'number' && skill.useCount >= 0 && (
              <span className="inline-flex items-center gap-1">
                <ArrowDownToLine className="h-3.5 w-3.5 opacity-55 flex-shrink-0" />
                {skill.useCount >= 1000 ? `${(skill.useCount / 1000).toFixed(1)}k` : skill.useCount}
              </span>
            )}
          </div>
          {skill.points !== null && (
            <span className="flex-shrink-0">
              {t('plaza.meta.points', { count: skill.points, defaultValue: `预计${skill.points}积分` })}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
