import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SkillCardListProps {
  skill: SkillSummary;
  onOpenDetail?: (skill: SkillSummary) => void;
  onDelete?: (skill: SkillSummary) => void;
}

export function SkillCardList({ skill, onOpenDetail, onDelete }: SkillCardListProps) {
  const { t } = useTranslation('skills');
  const [enabled, setEnabled] = useState(skill.enabled ?? false);
  const [isHovered, setIsHovered] = useState(false);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
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

  return (
    <div
      className="flex items-center gap-3 px-5 py-4 border-b border-border last:border-b-0 transition-colors cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenDetail?.(skill)}
    >
      {renderIcon()}

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {skill.title}
        </h3>
        <p className="text-[13px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {skill.description}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(skill); }}
            className={cn(
              'inline-flex items-center justify-center w-8 h-8 p-0 border-none rounded-lg bg-transparent text-muted-foreground cursor-pointer hover:text-red-600 transition-all',
              isHovered ? 'opacity-100 visible' : 'opacity-0 invisible',
            )}
            title={t('plaza.action.delete', { defaultValue: '删除' })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => { handleToggle(checked); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('plaza.action.toggle', { defaultValue: '启用/禁用' })}
        />
      </div>
    </div>
  );
}
