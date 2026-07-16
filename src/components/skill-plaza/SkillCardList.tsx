import { memo, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import fileIcon from '@/assets/icons/file.svg';

interface SkillCardListProps {
  skill: SkillSummary;
  onOpenDetail?: (skill: SkillSummary) => void;
  onDelete?: (skill: SkillSummary) => void;
}

function SkillCardListImpl({ skill, onOpenDetail, onDelete }: SkillCardListProps) {
  const { t } = useTranslation('skills');
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const localEnabled = pendingEnabled ?? skill.enabled ?? false;
  const isDisabled = skill.enabled === false;

  // Normalize the inline SVG size once per icon change instead of on each render.
  const iconHtml = useMemo(
    () => (skill.icon
      ? skill.icon.replace(/width="[^"]*"/, 'width="16"').replace(/height="[^"]*"/, 'height="16"')
      : null),
    [skill.icon],
  );

  const renderIcon = () => {
    if (iconHtml) {
      return (
        <span
          className={cn(
            'relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-foreground flex-shrink-0 border border-border',
            isDisabled && 'opacity-50',
          )}
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
        >
          <span dangerouslySetInnerHTML={{ __html: iconHtml }} />
        </span>
      );
    }
    return (
      <span className={cn(
        'relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-foreground flex-shrink-0 border border-border',
        isDisabled && 'opacity-50',
      )}
        style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}>
        <img src={fileIcon} alt="" aria-hidden className="h-4 w-4 object-contain" />
      </span>
    );
  };

  return (
    <div
      className="group flex items-center gap-3 px-5 py-4 border-b border-border last:border-b-0 transition-colors cursor-pointer"
      onClick={() => onOpenDetail?.(skill)}
    >
      {renderIcon()}

      <div className={cn('flex-1 min-w-0 flex flex-col gap-0.5', isDisabled && 'opacity-50')}>
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
              'opacity-0 invisible group-hover:opacity-100 group-hover:visible',
            )}
            title={t('plaza.action.delete', { defaultValue: '删除' })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <Switch
          size="compact"
          className="data-[state=checked]:bg-[#00B54B] dark:data-[state=checked]:bg-[#00B54B]"
          checked={localEnabled}
          onCheckedChange={(checked) => {
            setPendingEnabled(checked);
            useSkillPlazaStore.getState().toggleSkill(skill.slug, checked).then(() => {
              setPendingEnabled(null);
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
              setPendingEnabled(null);
              console.error('[SkillCardList] toggle failed:', err);
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
    </div>
  );
}

// Memoized so list rows only re-render when their own props change.
export const SkillCardList = memo(SkillCardListImpl);
