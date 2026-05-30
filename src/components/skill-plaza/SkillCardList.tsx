import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SkillCardListProps {
  skill: SkillSummary;
  onDelete?: (skill: SkillSummary) => void;
}

export function SkillCardList({ skill, onDelete }: SkillCardListProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  // useSkill is called via store getState to avoid hook rules violation in handlers
  const [enabled, setEnabled] = useState(skill.enabled ?? false);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    // TODO: call enable/disable API when available
  };

  const handleUse = () => {
    const prompt = encodeURIComponent(skill.defaultPrompt || skill.title);
    navigate(`/conversation?q=${prompt}`);
    // Fire-and-forget use record
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <div
          className="w-8 h-8 flex-shrink-0"
          dangerouslySetInnerHTML={{ __html: skill.icon }}
        />
      );
    }
    return (
      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
        <span className="text-sm">📦</span>
      </div>
    );
  };

  const tag = skill.source === 'mine'
    ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: '#FFF5E6', text: '#D95700' }
    : { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: '#DCF5E2', text: '#00B54B' };

  return (
    <div
      className={cn(
        'flex items-center gap-4 p-3 rounded-xl border border-border bg-card',
        'hover:shadow-sm transition-all',
      )}
    >
      {renderIcon()}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-medium text-foreground text-sm">{skill.title}</h3>
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: tag.bg, color: tag.text }}
          >
            {tag.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label={t('plaza.action.toggle', { defaultValue: '启用/禁用' })}
        />

        <button
          onClick={handleUse}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF6F00] hover:bg-[#D95700] transition-colors"
        >
          <Play className="h-3 w-3" />
          {t('plaza.action.use', { defaultValue: '使用' })}
        </button>

        {onDelete && (
          <button
            onClick={() => onDelete(skill)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-[#FA3C3C] hover:bg-[#FA3C3C]/10 transition-colors"
            title={t('plaza.action.delete', { defaultValue: '删除' })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
