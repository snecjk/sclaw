import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ACTION_ICON_CLASS = 'h-[22px] w-[22px]';
const ACTION_ICON_COLOR = 'text-[#86909C] dark:text-[#A6A6A6]';

export function ComposeActionIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
        ACTION_ICON_COLOR,
        'transition-colors hover:bg-black/[0.04] hover:text-[#4E5969]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'dark:hover:bg-white/[0.06] dark:hover:text-[#C9CDD4]',
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export { ACTION_ICON_CLASS, ACTION_ICON_COLOR };
