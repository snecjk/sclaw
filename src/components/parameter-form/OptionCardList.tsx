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
              aria-disabled={!interactive ? 'true' : undefined}
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
                !isDock && 'sto-card sto-card--parameter-option',
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
                  : !interactive
                    ? 'border-[var(--sto-disabled-border)] bg-[var(--sto-disabled-background)] text-[var(--sto-disabled-foreground)]'
                    : selected
                      ? 'border-[var(--sto-form-selected-border)] bg-[var(--sto-form-selected-background)] shadow-[var(--sto-shadow-brand-subtle)]'
                      : 'border-[var(--sto-border-default)] bg-[var(--sto-card-panel-bg)] hover:border-[var(--sto-form-option-hover-border)]',
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
                    : cn(
                        'mt-0.5 h-6 w-6 rounded-full text-[11px] font-bold',
                        interactive
                          ? 'bg-[var(--sto-brand-6)] text-white'
                          : 'bg-[var(--sto-disabled-background)] text-[var(--sto-disabled-foreground)]',
                      ),
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-medium leading-[18px] text-foreground',
                      isDock
                        ? 'text-sm'
                        : cn(
                            'text-[14px] font-semibold leading-snug',
                            interactive
                              ? 'text-[var(--sto-text-primary)]'
                              : 'text-[var(--sto-disabled-foreground)]',
                          ),
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
                        : cn(
                            'mt-1 text-[12.5px] leading-relaxed',
                            interactive
                              ? 'text-[var(--sto-text-tertiary)]'
                              : 'text-[var(--sto-disabled-foreground)]',
                          ),
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
        <p className="text-[12.5px] text-[var(--sto-text-tertiary)]">
          {selectionLabel}：
          <span className="font-medium text-[var(--sto-text-secondary)]">{selectedLabels.join('、')}</span>
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
