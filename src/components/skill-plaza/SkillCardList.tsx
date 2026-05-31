import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';

interface SkillCardListProps {
  skill: SkillSummary;
  onDelete?: (skill: SkillSummary) => void;
}

export function SkillCardList({ skill, onDelete }: SkillCardListProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(skill.enabled ?? false);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
  };

  const handleUse = () => {
    const prompt = encodeURIComponent(skill.defaultPrompt || skill.title);
    navigate(`/?q=${prompt}`);
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <span
          className="relative w-11 h-11 rounded-[10px] flex items-center justify-center bg-white text-[#2b2b2b] flex-shrink-0 border border-black/[0.06]"
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
        >
          <span dangerouslySetInnerHTML={{ __html: skill.icon.replace(/width="[^"]*"/, 'width="18"').replace(/height="[^"]*"/, 'height="18"') }} />
        </span>
      );
    }
    return (
      <span className="relative w-11 h-11 rounded-[10px] flex items-center justify-center bg-white text-[#2b2b2b] flex-shrink-0 border border-black/[0.06]"
        style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}>
        <span className="text-lg">📦</span>
      </span>
    );
  };

  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 border-b border-border last:border-b-0 hover:bg-black/[0.02] transition-colors">
      {renderIcon()}

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {skill.title}
        </h3>
        <p className="text-[13px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {skill.description}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label={t('plaza.action.toggle', { defaultValue: '启用/禁用' })}
        />

        <button
          onClick={handleUse}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-foreground bg-[#f1f3f5] hover:bg-[#e8eaed] transition-colors"
        >
          <Play className="h-3 w-3" />
          {t('plaza.action.use', { defaultValue: '使用' })}
        </button>

        {onDelete && (
          <button
            onClick={() => onDelete(skill)}
            className="inline-flex items-center justify-center w-8 h-8 p-0 border-none rounded-lg bg-transparent text-muted-foreground cursor-pointer hover:bg-red-500/[0.08] hover:text-red-600 transition-colors"
            title={t('plaza.action.delete', { defaultValue: '删除' })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
