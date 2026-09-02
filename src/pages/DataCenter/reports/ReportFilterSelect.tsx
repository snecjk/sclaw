import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formFieldOpenClass,
  schedulePickerDropdownPanelClass,
} from '@/lib/surfaces';

export interface ReportFilterSelectOption {
  value: string;
  label: string;
}

interface ReportFilterSelectProps {
  value: string;
  options: ReportFilterSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  filterable?: boolean;
  loading?: boolean;
  className?: string;
}

function optionClass(active: boolean) {
  return cn(
    'transition-[background,color]',
    active
      ? 'bg-[#F2F3F5] font-semibold text-[#1D2129] dark:bg-muted dark:text-foreground'
      : 'text-[#1D2129] hover:bg-[#F2F3F5] dark:text-foreground dark:hover:bg-muted',
  );
}

const triggerClass = cn(
  'sto-control sto-control--field box-border flex h-[34px] w-full cursor-pointer items-center gap-1.5',
  'rounded-[10px] border px-3 text-[13px] text-[#1D2129] outline-none transition-colors dark:text-foreground',
  'hover:border-[#1D2129]/40 dark:hover:border-foreground/40',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function ReportFilterSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  clearable = false,
  filterable = false,
  loading = false,
  className,
}: ReportFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((item) => item.value === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q),
    );
  }, [keyword, options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setKeyword('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open && filterable) {
      const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, filterable]);

  const toggle = () => {
    if (disabled || loading) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) setKeyword('');
      return next;
    });
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={toggle}
        className={cn(triggerClass, open && formFieldOpenClass, !selected && 'text-[#86909C]')}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected?.label || placeholder}
        </span>
        {clearable && selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#86909C] hover:text-[#1D2129] dark:hover:text-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#86909C]" />
        ) : (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[#86909C] transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-full min-w-[220px]">
          <div className={cn(schedulePickerDropdownPanelClass, 'flex max-h-[280px] flex-col p-1.5')}>
            {filterable ? (
              <div className="mb-1 flex items-center gap-2 rounded-lg border border-[#E5E6EB] px-2.5 py-1.5 dark:border-border">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#86909C]" />
                <input
                  ref={searchRef}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索"
                  className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] text-[#1D2129] outline-none placeholder:text-[#86909C] dark:text-foreground"
                />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-2.5 py-6 text-center text-[12px] text-[#86909C]">暂无选项</div>
              ) : (
                filtered.map((item) => {
                  const active = item.value === value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        onChange(item.value);
                        setOpen(false);
                        setKeyword('');
                      }}
                      className={cn(
                        'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]',
                        optionClass(active),
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      <span className={cn('flex h-4 w-4 shrink-0 text-[#1D2129] dark:text-foreground', !active && 'opacity-0')}>
                        <Check className="h-4 w-4" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
