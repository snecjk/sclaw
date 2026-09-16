import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { inlineSelectMenuClass, inlineSelectTriggerClass } from './styles';
import type { InlineSelectOption } from './types';

export function ChannelInlineSelect({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            inlineSelectTriggerClass,
            disabled && 'cursor-not-allowed opacity-70 hover:bg-white dark:hover:bg-transparent',
            className,
          )}
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label || '—'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      {!disabled ? (
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={4}
          avoidCollisions={false}
          className={cn(inlineSelectMenuClass, 'w-[var(--radix-dropdown-menu-trigger-width)]')}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <DropdownMenuItem
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-[#1D2129]',
                  'focus:bg-[#F7F8FA] dark:text-foreground dark:focus:bg-white/[0.06]',
                  isSelected && 'bg-[#F7F8FA] dark:bg-white/[0.06]',
                )}
                onSelect={() => onChange(option.value)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}
