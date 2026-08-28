import { cn } from '@/lib/utils';
import type { EmbedComposerAction } from '../../../shared/embed-composer-actions';
import { dispatchChatSend } from '@/hooks/dispatch-chat-send';
import { useComposerFlowStore } from '@/stores/composer-flow';
import type { SkillMeta } from '@/types/skill-meta';

interface ComposerScenarioPillsProps {
  actions: EmbedComposerAction[];
  activeId?: string | null;
  disabled?: boolean;
  className?: string;
}

function toSkillMetas(action: EmbedComposerAction): SkillMeta[] | undefined {
  if (!action.skillSlugs?.length) return undefined;
  return action.skillSlugs.map((slug) => ({
    slug,
    title: action.label,
  }));
}

export function ComposerScenarioPills({
  actions,
  activeId,
  disabled = false,
  className,
}: ComposerScenarioPillsProps) {
  if (!actions.length) return null;

  const handleClick = async (action: EmbedComposerAction) => {
    if (action.disabled || disabled) return;
    useComposerFlowStore.getState().setActiveScenario(action.id);
    await dispatchChatSend({
      text: action.sendText,
      skillMetas: toSkillMetas(action),
    });
  };

  return (
    <div
      className={cn('flex flex-wrap gap-2 px-1 pb-2', className)}
      aria-label="快捷入口"
    >
      {actions.map((action) => {
        const isActive = activeId === action.id;
        const isDisabled = disabled || action.disabled;
        return (
          <button
            key={action.id}
            type="button"
            disabled={isDisabled}
            title={action.tip}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium transition-colors',
              isActive
                ? 'border-[#FF6700] text-[#FF6700] bg-[#FF6700]/5'
                : 'border-border text-muted-foreground hover:border-[#FF6700]/40 hover:text-foreground',
              isDisabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => void handleClick(action)}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
