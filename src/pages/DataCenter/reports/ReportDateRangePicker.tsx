import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formFieldOpenClass,
  schedulePickerDropdownPanelClass,
} from '@/lib/surfaces';

export type ReportDateRangeValue = [string, string] | null;

interface ReportDateRangePickerProps {
  value: ReportDateRangeValue;
  onChange: (value: ReportDateRangeValue) => void;
  disabled?: boolean;
  className?: string;
  startPlaceholder?: string;
  endPlaceholder?: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseYmd(value?: string | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function startWeekday(year: number, month: number) {
  // 周一为一周起点：0=周一 … 6=周日
  const js = new Date(year, month - 1, 1).getDay();
  return (js + 6) % 7;
}

function compareYmd(a: string, b: string) {
  return a.localeCompare(b);
}

function inRange(day: string, start?: string | null, end?: string | null) {
  if (!start || !end) return false;
  return compareYmd(day, start) >= 0 && compareYmd(day, end) <= 0;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const triggerClass = cn(
  'sto-control sto-control--field box-border flex h-[34px] w-full cursor-pointer items-center gap-2',
  'rounded-[10px] border px-3 text-[13px] text-[#1D2129] outline-none transition-colors dark:text-foreground',
  'hover:border-[#1D2129]/40 dark:hover:border-foreground/40',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function ReportDateRangePicker({
  value,
  onChange,
  disabled = false,
  className,
  startPlaceholder = '开始日期',
  endPlaceholder = '结束日期',
}: ReportDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<string | null>(value?.[0] || null);
  const [draftEnd, setDraftEnd] = useState<string | null>(value?.[1] || null);
  const rootRef = useRef<HTMLDivElement>(null);

  const initialCursor = useMemo(() => {
    const parsed = parseYmd(value?.[0] || value?.[1]) || {
      y: new Date().getFullYear(),
      m: new Date().getMonth() + 1,
      d: 1,
    };
    return { y: parsed.y, m: parsed.m };
  }, [value]);

  const [cursor, setCursor] = useState(initialCursor);

  useEffect(() => {
    if (!open) return;
    setDraftStart(value?.[0] || null);
    setDraftEnd(value?.[1] || null);
    setCursor(initialCursor);
  }, [open, value, initialCursor]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cells = useMemo(() => {
    const total = daysInMonth(cursor.y, cursor.m);
    const offset = startWeekday(cursor.y, cursor.m);
    const list: Array<{ key: string; label: string; ymd: string | null }> = [];
    for (let i = 0; i < offset; i += 1) {
      list.push({ key: `pad-${i}`, label: '', ymd: null });
    }
    for (let d = 1; d <= total; d += 1) {
      const ymd = toYmd(cursor.y, cursor.m, d);
      list.push({ key: ymd, label: String(d), ymd });
    }
    return list;
  }, [cursor]);

  const displayText = value
    ? `${value[0]} 至 ${value[1]}`
    : `${startPlaceholder} 至 ${endPlaceholder}`;

  const shiftMonth = (delta: number) => {
    setCursor((prev) => {
      const date = new Date(prev.y, prev.m - 1 + delta, 1);
      return { y: date.getFullYear(), m: date.getMonth() + 1 };
    });
  };

  const pickDay = (ymd: string) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(ymd);
      setDraftEnd(null);
      return;
    }
    if (compareYmd(ymd, draftStart) < 0) {
      setDraftEnd(draftStart);
      setDraftStart(ymd);
    } else {
      setDraftEnd(ymd);
    }
  };

  const confirm = () => {
    if (draftStart && draftEnd) {
      onChange([draftStart, draftEnd]);
      setOpen(false);
    }
  };

  const clear = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setDraftStart(null);
    setDraftEnd(null);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        className={cn(triggerClass, open && formFieldOpenClass, !value && 'text-[#86909C]')}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#86909C]" />
        <span className="min-w-0 flex-1 truncate text-left">{displayText}</span>
        {value && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#86909C] hover:text-[#1D2129] dark:hover:text-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[288px]">
          <div className={cn(schedulePickerDropdownPanelClass, 'flex flex-col gap-2 p-3')}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted"
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-[13px] font-semibold text-[#1D2129] dark:text-foreground">
                {cursor.y}年{cursor.m}月
              </div>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted"
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 text-center text-[11px] text-[#86909C]">
                  {w}
                </div>
              ))}
              {cells.map((cell) => {
                if (!cell.ymd) {
                  return <div key={cell.key} className="h-8" />;
                }
                const isStart = cell.ymd === draftStart;
                const isEnd = cell.ymd === draftEnd;
                const mid = inRange(cell.ymd, draftStart, draftEnd);
                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => pickDay(cell.ymd!)}
                    className={cn(
                      'h-8 rounded-md text-[12px] transition-colors',
                      mid && !isStart && !isEnd && 'bg-[#F2F3F5] text-[#1D2129] dark:bg-muted dark:text-foreground',
                      (isStart || isEnd) && 'bg-[#1D2129] font-semibold text-white dark:bg-foreground dark:text-background',
                      !mid && !isStart && !isEnd && 'text-[#1D2129] hover:bg-[#F2F3F5] dark:text-foreground dark:hover:bg-muted',
                    )}
                  >
                    {cell.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[#E5E6EB] pt-2 dark:border-border">
              <span className="truncate text-[11px] text-[#86909C]">
                {draftStart || startPlaceholder}
                {' ~ '}
                {draftEnd || endPlaceholder}
              </span>
              <button
                type="button"
                disabled={!draftStart || !draftEnd}
                onClick={confirm}
                className={cn(
                  'h-7 rounded-md px-2.5 text-[12px] font-medium',
                  draftStart && draftEnd
                    ? 'bg-[#1D2129] text-white dark:bg-foreground dark:text-background'
                    : 'cursor-not-allowed bg-[#F2F3F5] text-[#C9CDD4]',
                )}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
