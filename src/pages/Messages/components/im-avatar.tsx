import { Bot, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type ImAvatarKind = 'single' | 'group' | 'digital_employee';

const sizeClass = {
  xs: 'h-8 w-8 text-[12px]',
  sm: 'h-9 w-9 text-[13px]',
  md: 'h-10 w-10 text-sm',
} as const;

const iconSizeClass = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-4 w-4',
} as const;

export function ImAvatar({
  kind,
  label,
  size = 'md',
  className,
}: {
  kind: ImAvatarKind;
  label: string;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  const isDigital = kind === 'digital_employee';
  const isGroup = kind === 'group';

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[8px] border border-[var(--sto-border-default)] font-medium',
        sizeClass[size],
        isDigital && 'bg-[var(--sto-badge-external-background)] text-[var(--sto-badge-external-foreground)]',
        isGroup && 'bg-[#E8F3FF] text-[#1677FF]',
        !isDigital && !isGroup && 'bg-[var(--sto-surface-muted)] text-[var(--sto-text-secondary)]',
        className,
      )}
    >
      {isDigital ? (
        <Bot className={iconSizeClass[size]} strokeWidth={1.5} />
      ) : isGroup ? (
        <Users className={iconSizeClass[size]} strokeWidth={1.5} />
      ) : (
        label
      )}
    </div>
  );
}
