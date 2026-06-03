import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, ArrowDownToLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { Switch } from '@/components/ui/switch';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SkillCardProps {
  skill: SkillSummary;
  onOpenDetail?: (skill: SkillSummary) => void;
  onDelete?: (skill: SkillSummary) => void;
  isMineTab?: boolean;
}

export function SkillCard({ skill, onOpenDetail, onDelete, isMineTab }: SkillCardProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const { installing } = useSkillPlazaStore();
  const [isHovered, setIsHovered] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(skill.enabled ?? false);
  useEffect(() => {
    setLocalEnabled(skill.enabled ?? false);
  }, [skill.enabled]);
  const isInstalling = installing[skill.slug];
  const isDisabled = skill.enabled === false;

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
    installSkill(skill.slug, {
      version: skill.version,
      force: skill.updateAvailable,
      title: skill.title,
      description: skill.description,
    }).then(() => fetchPlazaSkills({ reset: true })).catch(() => {});
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <span
          className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-background text-foreground flex-shrink-0 border border-border"
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
        >
          <span dangerouslySetInnerHTML={{ __html: skill.icon.replace(/width="[^"]*"/, 'width="16"').replace(/height="[^"]*"/, 'height="16"') }} />
        </span>
      );
    }
    return (
      <span className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-background text-foreground flex-shrink-0 border border-border"
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
      className="relative flex flex-col min-w-0 pt-3.5 px-4 pb-3.5 border border-border rounded-xl bg-background cursor-pointer overflow-visible transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenDetail?.(skill)}
      data-skill-installed={canUse}
    >
      {/* Quick actions - top right */}
      {isMineTab ? (
        <div className="absolute top-3.5 right-4 z-[3] flex items-center gap-1.5">
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(skill); }}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 p-0 border-none rounded-full bg-transparent text-muted-foreground cursor-pointer hover:text-red-600 transition-all',
                isHovered ? 'opacity-100 visible' : 'opacity-0 invisible',
              )}
              title={t('plaza.action.delete', { defaultValue: '删除' })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <Switch
            checked={localEnabled}
            onCheckedChange={(checked) => {
              setLocalEnabled(checked);
              useSkillPlazaStore.getState().toggleSkill(skill.slug, checked).then(() => {
                if (!checked) {
                  toast.custom(() => (
                    <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                      技能已关闭，仍可在「我的技能」中查看
                    </div>
                  ), { duration: 3000 });
                } else {
                  toast.custom(() => (
                    <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                      技能已开启
                    </div>
                  ), { duration: 3000 });
                }
              }).catch((err) => {
                // Rollback on error
                setLocalEnabled(!checked);
                console.error('[SkillCard] toggle failed:', err);
                toast.custom(() => (
                  <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                    操作失败，请重试
                  </div>
                ), { duration: 3000 });
              });
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
          {skill.updateAvailable ? (
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="inline-flex items-center justify-center h-7 px-3.5 border-none rounded-full bg-amber-100 text-xs font-semibold text-amber-800 cursor-pointer whitespace-nowrap no-underline shadow-sm transition-colors hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
            >
              {isInstalling ? (
                <span className="animate-spin h-3 w-3 border-2 border-amber-800/30 border-t-amber-800 rounded-full dark:border-amber-200/30 dark:border-t-amber-200" />
              ) : (
                t('plaza.action.update', { defaultValue: '更新' })
              )}
            </button>
          ) : canUse ? (
            <button
              onClick={handleUse}
              className="inline-flex items-center justify-center h-7 px-3.5 border-none rounded-full bg-muted text-xs font-semibold text-foreground cursor-pointer whitespace-nowrap no-underline shadow-sm transition-colors hover:bg-muted/80"
            >
              {t('plaza.action.use', { defaultValue: '使用' })}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="inline-flex items-center justify-center h-7 px-3.5 border-none rounded-full bg-muted text-xs font-semibold text-foreground cursor-pointer whitespace-nowrap no-underline shadow-sm transition-colors hover:bg-muted/80 disabled:opacity-50"
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
      <div className={cn('flex flex-col flex-1 min-h-0 no-underline text-inherit', isDisabled && 'opacity-50')}>
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
            {typeof skill.useCount === 'number' && skill.useCount >= 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5 opacity-55 flex-shrink-0" />
                {skill.useCount >= 1000 ? `${(skill.useCount / 1000).toFixed(1)}k` : skill.useCount}
              </span>
            )}
            {typeof skill.installCount === 'number' && skill.installCount >= 0 && (
              <span className="inline-flex items-center gap-1">
                <ArrowDownToLine className="h-3.5 w-3.5 opacity-55 flex-shrink-0" />
                {skill.installCount >= 1000 ? `${(skill.installCount / 1000).toFixed(1)}k` : skill.installCount}
              </span>
            )}
          </div>
          {/* 2026.6.3 暂时不支持 */}
          {/* {skill.points !== null && (
            <span className="flex-shrink-0">
              {t('plaza.meta.points', { count: skill.points, defaultValue: `预计${skill.points}积分` })}
            </span>
          )} */}
        </div>
      </div>
    </article>
  );
}
