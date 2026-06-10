/**
 * Card-style option list for workflow parameter forms.
 * Matches STO inline form pattern: numbered brand badge + title + description.
 */
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormFieldOption } from '@/types/user-form';

export type OptionCardMode = 'single' | 'multi' | 'display';

interface OptionCardListProps {
  options: FormFieldOption[];
  mode: OptionCardMode;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  selectionLabel?: string;
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
}: OptionCardListProps) {
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
    <div className="space-y-2.5">
      <div className="space-y-2.5">
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
                'w-full flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all',
                interactive && 'cursor-pointer',
                !interactive && 'cursor-default',
                isDisplay
                  ? 'border-[#E5E6EB] bg-[#F5F6F7]'
                  : selected
                    ? 'border-[var(--sto-brand-6)] bg-[#FFF5E6] shadow-[0_1px_2px_rgba(255,111,0,0.08)]'
                    : 'border-[#E5E6EB] bg-white hover:border-[#FFD7A3]',
                option.disabled && 'opacity-60',
              )}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sto-brand-6)] text-[11px] font-bold text-white">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold leading-snug text-[#1D2129]">
                    {option.label}
                  </span>
                  {selected && mode === 'multi' && (
                    <Check className="h-4 w-4 shrink-0 text-[var(--sto-brand-6)]" strokeWidth={2.5} />
                  )}
                </div>
                {option.description && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[#86909C]">
                    {option.description}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {mode === 'multi' && selectedLabels.length > 0 && (
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
