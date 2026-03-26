import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

interface QuickActionsProps {
  onAction: (text: string) => void;
}

const ACTION_KEYS = ['quickAction1', 'quickAction2', 'quickAction3', 'quickAction4'] as const;

export function QuickActions({ onAction }: QuickActionsProps) {
  const { t } = useTranslation('sprite');

  return (
    <div className="flex flex-col gap-2 px-5">
      {ACTION_KEYS.map((key) => (
        <button
          key={key}
          onClick={() => onAction(t(key))}
          className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-glass-border text-sm text-foreground/70 hover:bg-white/20 dark:hover:bg-white/10 transition-colors glass-subtle text-left"
        >
          <span>{t(key)}</span>
          <ChevronRight className="h-4 w-4 text-foreground/40 shrink-0 ml-2" />
        </button>
      ))}
    </div>
  );
}
