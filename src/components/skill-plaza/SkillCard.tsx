import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Play, Trash2 } from 'lucide-react';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
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
  const isInstalling = installing[skill.slug];

  const tag = skill.installed
    ? { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: '#DCF5E2', text: '#00B54B' }
    : skill.source === 'mine'
      ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: '#FFF5E6', text: '#D95700' }
      : { label: t('plaza.tag.official', { defaultValue: '官方' }), bg: '#F0F4FF', text: '#4760FE' };

  const handleUse = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prompt = encodeURIComponent(skill.defaultPrompt || skill.title);
    navigate(`/conversation?q=${prompt}`);
    // Fire-and-forget use record
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { installSkill, fetchPlazaSkills } = useSkillPlazaStore.getState();
    await installSkill(skill.slug);
    await fetchPlazaSkills({ reset: true });
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <div
          className="w-10 h-10 flex-shrink-0"
          dangerouslySetInnerHTML={{ __html: skill.icon }}
        />
      );
    }
    return (
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        <span className="text-lg">📦</span>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'group relative rounded-xl border border-border bg-card p-4 cursor-pointer',
        'transition-all hover:shadow-md hover:border-[#FF6F00]/30',
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenDetail?.(skill)}
    >
      <div className="flex items-start gap-3">
        {renderIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-foreground text-sm truncate">{skill.title}</h3>
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ backgroundColor: tag.bg, color: tag.text }}
            >
              {tag.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-2">
            {skill.description}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
          </div>
        </div>
      </div>

      {/* Hover actions */}
      <div
        className={cn(
          'absolute right-3 bottom-3 flex items-center gap-2 transition-opacity duration-200',
          isHovered ? 'opacity-100' : 'opacity-0',
        )}
      >
        {isMineTab && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(skill);
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-[#FA3C3C] hover:bg-[#FA3C3C]/10 transition-colors"
            title={t('plaza.action.delete', { defaultValue: '删除' })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        {skill.installed || skill.source === 'mine' ? (
          <button
            onClick={handleUse}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF6F00] hover:bg-[#D95700] transition-colors"
          >
            <Play className="h-3 w-3" />
            {t('plaza.action.use', { defaultValue: '使用' })}
          </button>
        ) : (
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF6F00] hover:bg-[#D95700] transition-colors disabled:opacity-50"
          >
            {isInstalling ? (
              <span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {t('plaza.action.install', { defaultValue: '安装' })}
          </button>
        )}
      </div>
    </div>
  );
}
