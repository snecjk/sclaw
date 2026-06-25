/**
 * Card-style option list for workflow parameter forms.
 * Matches STO inline form pattern: numbered brand badge + title + description.
 */
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parameterFormDockOptionHoverClass,
  parameterFormDockOptionSelectedClass,
} from '@/lib/surfaces';
import type { FormFieldOption } from '@/types/user-form';

export type OptionCardMode = 'single' | 'multi' | 'display';
export type OptionCardVariant = 'default' | 'chat-dock';

export interface OptionCardListProps {
  options: FormFieldOption[];
  mode: OptionCardMode;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  selectionLabel?: string;
  /** chat-dock：MasterGo 8:08038 / 8:07921 浮层选项卡样式 */
  variant?: OptionCardVariant;
}

function isSelected(
  mode: OptionCardMode,
  option: FormFieldOption,
  value: unknown,
): boolean {
  if (mode === 'single') return value === option.value;
  if (mode === 'multi') {
    const current = Array.isArray(value) ? (value as unknown[]) : [];
    return current.some((v) => String(v) === String(option.value));
  }
  return false;
}

export function OptionCardList({
  options,
  mode,
  value,
  onChange,
  disabled,
  selectionLabel = '已选',
  variant = 'default',
}: OptionCardListProps) {
  const isDock = variant === 'chat-dock';
  const isDisplay = mode === 'display' || disabled;
  const multiValues = mode === 'multi' && Array.isArray(value) ? (value as unknown[]) : [];

  const toggleMulti = (option: FormFieldOption) => {
    if (isDisplay || option.disabled) return;
    const optVal = option.value;
    if (multiValues.some((v) => String(v) === String(optVal))) {
      onChange(multiValues.filter((v) => String(v) !== String(optVal)));
    } else {
      onChange([...multiValues, optVal]);
    }
  };

  const selectedLabels = options
    .filter((o) => isSelected(mode, o, value))
    .map((o) => o.label);

  return (
    <div className={cn(isDock ? 'space-y-1' : 'space-y-2.5')}>
      <div className={cn(isDock ? 'space-y-1' : 'space-y-2.5')}>
        {options.map((option, index) => {
          const selected = !isDisplay && isSelected(mode, option, value);
          const interactive = !isDisplay && !option.disabled;

          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={!interactive}
              onClick={() => {
                if (!interactive) return;
                if (mode === 'single') {
                  onChange(option.value);
                } else if (mode === 'multi') {
                  toggleMulti(option);
                }
              }}
              className={cn(
                'flex w-full items-start text-left transition-colors duration-fast',
                isDock
                  ? 'gap-3 rounded-[10px] p-2'
                  : 'gap-3 rounded-xl border px-4 py-3.5 transition-all',
                interactive && 'cursor-pointer',
                !interactive && 'cursor-default',
                isDock
                  ? isDisplay
                    ? 'bg-muted/60'
                    : selected
                      ? parameterFormDockOptionSelectedClass
                      : parameterFormDockOptionHoverClass
                  : isDisplay
                    ? 'border-[#E5E6EB] bg-[#F5F6F7]'
                    : selected
                      ? 'border-[var(--sto-brand-6)] bg-[#FFF5E6] shadow-[0_1px_2px_rgba(255,111,0,0.08)]'
                      : 'border-[#E5E6EB] bg-white hover:border-[#FFD7A3]',
                option.disabled && 'opacity-60',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center font-medium',
                  isDock
                    ? cn(
                        'mt-0.5 h-[18px] w-[18px] rounded-[9px] text-[10px] leading-[10px]',
                        isDisplay || !selected
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary text-primary-foreground',
                      )
                    : 'mt-0.5 h-6 w-6 rounded-full bg-[var(--sto-brand-6)] text-[11px] font-bold text-white',
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-medium leading-[18px] text-foreground',
                      isDock ? 'text-sm' : 'text-[14px] font-semibold leading-snug text-[#1D2129]',
                    )}
                  >
                    {option.label}
                  </span>
                  {selected && mode === 'multi' && !isDock && (
                    <Check className="h-4 w-4 shrink-0 text-[var(--sto-brand-6)]" strokeWidth={2.5} />
                  )}
                </div>
                {option.description && (
                  <p
                    className={cn(
                      isDock
                        ? 'mt-0.5 text-xs leading-[14px] text-muted-foreground'
                        : 'mt-1 text-[12.5px] leading-relaxed text-[#86909C]',
                    )}
                  >
                    {option.description}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {mode === 'multi' && selectedLabels.length > 0 && !isDock && (
        <p className="text-[12.5px] text-[#86909C]">
          {selectionLabel}：
          <span className="font-medium text-[#4E5969]">{selectedLabels.join('、')}</span>
        </p>
      )}
    </div>
  );
}

/** Split semicolon-separated rule text into display tags. */
export function splitRuleTags(text: unknown): string[] {
  if (text === undefined || text === null || text === '') return [];
  return String(text)
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
