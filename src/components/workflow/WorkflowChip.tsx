import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface WorkflowChipProps {
  name: string;
  onRemove: () => void;
}

export function WorkflowChip({ name, onRemove }: WorkflowChipProps) {
  const { t } = useTranslation('chat');
  return (
    <button
      type="button"
      onClick={onRemove}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border',
        'bg-primary/6 px-3 py-1 text-[13px] font-medium text-foreground',
        'transition-colors hover:bg-primary/10',
      )}
      title={t('composer.workflowClear')}
    >
      <span className="text-primary">/</span>
      <span>{name}</span>
      <X className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}
