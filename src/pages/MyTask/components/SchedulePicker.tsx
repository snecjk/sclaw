import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  dropdownOptionClass,
  formFieldOpenClass,
  schedulePickerDropdownPanelClass,
  schedulePickerTriggerClass,
} from '@/lib/surfaces';

export interface ScheduleValue {
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  onceDate?: string;
  weekDays: number[];     // 多选星期: 0=周日, 1=周一
  monthDay?: number;      // 1-31
  time: string;           // "HH:mm"
}

/** 下拉弹出方向 */
type DropDirection = 'down' | 'up';

/** 下拉面板预估高度 */
const DROPDOWN_ESTIMATE_HEIGHT = 300;

/**
 * 根据 trigger 在视口中的位置，智能判断下拉展开方向。
 * 下方空间不足时向上展开，否则向下。
 */
function useDropdownDirection(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
): DropDirection {
  const [dir, setDir] = useState<DropDirection>('down');
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setDir(spaceBelow < DROPDOWN_ESTIMATE_HEIGHT ? 'up' : 'down');
  }, [open, triggerRef]);
  return dir;
}

/** 根据方向返回下拉面板的 className */
function dropdownPositionClass(dir: DropDirection): string {
  return dir === 'up'
    ? 'absolute bottom-[calc(100%+6px)] left-0 z-20'
    : 'absolute top-[calc(100%+6px)] left-0 z-20';
}

function dropdownPositionClassRight(dir: DropDirection): string {
  return dir === 'up'
    ? 'absolute bottom-[calc(100%+6px)] right-0 z-20'
    : 'absolute top-[calc(100%+6px)] right-0 z-20';
}

const FREQUENCY_OPTIONS = [
  { value: 'daily' as const, label: '每天' },
  { value: 'weekly' as const, label: '每周' },
  { value: 'monthly' as const, label: '每月' },
  { value: 'once' as const, label: '一次性' },
];

const WEEKDAY_FULL_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_DROPDOWN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const scheduleCalendarNavButtonClass = cn(
  'flex h-7 w-7 items-center justify-center rounded-md text-base text-muted-foreground transition-colors',
  'hover:bg-muted hover:text-foreground',
);

const scheduleCalendarDayHoverClass =
  'text-foreground hover:bg-primary/10 hover:text-primary';

interface SchedulePickerProps {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
}

// ─── ChevronDown Icon ──────────────────────────────────────────────────────
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Clock Icon ─────────────────────────────────────────────────────────────
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── 频率下拉 ───────────────────────────────────────────────────────────────
function FrequencyPicker({
  value,
  onChange,
  onOpenChange,
}: {
  value: ScheduleValue['frequency'];
  onChange: (v: ScheduleValue['frequency']) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dir = useDropdownDirection(ref, open);
  const displayLabel = FREQUENCY_OPTIONS.find(o => o.value === value)?.label || '每天';

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={cn(schedulePickerTriggerClass, open ? formFieldOpenClass : 'border-border')}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="shrink-0 text-muted-foreground"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className={cn(dropdownPositionClass(dir), 'w-full min-w-[140px]')}>
          <div className={cn(schedulePickerDropdownPanelClass, 'flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1.5')}>
            {FREQUENCY_OPTIONS.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); onOpenChange(false); }}
                  className={cn(
                    'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm',
                    dropdownOptionClass(selected),
                  )}
                >
                  <span>{opt.label}</span>
                  <span className={cn('flex h-4 w-4 shrink-0 text-primary', !selected && 'opacity-0')}>
                    <Check className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 星期多选下拉 ──────────────────────────────────────────────────────────
function WeekdaysPicker({
  weekDays,
  onChange,
  onOpenChange,
}: {
  weekDays: number[];
  onChange: (days: number[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dir = useDropdownDirection(ref, open);

  const displayLabel = useMemo(() => {
    if (weekDays.length === 7) return '每天';
    if (weekDays.length === 5 && weekDays.every(d => [1, 2, 3, 4, 5].includes(d))) return '工作日';
    if (weekDays.length === 0) return '请选择';
    return weekDays.slice().sort((a, b) => a - b).map(d => WEEKDAY_FULL_LABELS[d]).join('、');
  }, [weekDays]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, onOpenChange]);

  function handleOptionClick(optValue: number) {
    const next = weekDays.includes(optValue)
      ? weekDays.filter(d => d !== optValue)
      : [...weekDays, optValue].sort((a, b) => a - b);
    onChange(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          schedulePickerTriggerClass,
          weekDays.length === 0 ? 'text-muted-foreground' : 'text-foreground',
          open ? formFieldOpenClass : 'border-border',
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="shrink-0 text-muted-foreground"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className={cn(dropdownPositionClass(dir), 'w-full min-w-[140px]')}>
          <div className={cn(schedulePickerDropdownPanelClass, 'flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1.5')}>
            {WEEKDAY_DROPDOWN_OPTIONS.map((opt) => {
              const checked = weekDays.includes(opt.value);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => handleOptionClick(opt.value)}
                  className={cn(
                    'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm',
                    dropdownOptionClass(checked),
                  )}
                >
                  <span>{opt.label}</span>
                  <span className={cn('flex h-4 w-4 shrink-0 text-primary', !checked && 'opacity-0')}>
                    <Check className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 一次性日期选择器（自定义日历） ─────────────────────────────────────────
function OnceDatePicker({
  onceDate,
  onChange,
  onOpenChange,
}: {
  onceDate?: string;
  onChange: (date: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dir = useDropdownDirection(ref, open);
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const displayLabel = onceDate
    ? (() => {
        const d = new Date(onceDate);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })()
    : '请选择日期';

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, onOpenChange]);

  // 构建日历格子
  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    // 周一起始: 0=Mon, 6=Sun
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: { day: number; inMonth: boolean; date: Date }[] = [];
    // 上月尾部
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      cells.push({ day: d, inMonth: false, date: new Date(viewYear, viewMonth - 1, d) });
    }
    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, inMonth: true, date: new Date(viewYear, viewMonth, d) });
    }
    // 下月头部至 42 格 (6行)
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, inMonth: false, date: new Date(viewYear, viewMonth + 1, d) });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  function selectDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    onChange(`${y}-${m}-${day}`);
    setOpen(false);
    onOpenChange(false);
  }

  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    selectDate(today);
  }

  const title = `${viewYear}年${viewMonth + 1}月`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={cn(schedulePickerTriggerClass, 'tabular-nums', open ? formFieldOpenClass : 'border-border')}
      >
        <span className={cn('truncate', !onceDate && 'font-normal text-muted-foreground')}>{displayLabel}</span>
        <span className="shrink-0 text-muted-foreground"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className={cn(dir === 'up' ? 'absolute bottom-[calc(100%+6px)] left-0 z-[25]' : 'absolute top-[calc(100%+6px)] left-0 z-[25]', 'w-[min(300px,calc(100vw-48px))]')}>
          <div className={cn(schedulePickerDropdownPanelClass, 'p-3 pb-2.5')}>
            {/* Header nav */}
            <div className="mb-2.5 flex items-center justify-center gap-1">
              <button type="button" onClick={() => setViewYear(v => v - 1)} className={scheduleCalendarNavButtonClass}>«</button>
              <button type="button" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); } else setViewMonth(m => m - 1); }} className={scheduleCalendarNavButtonClass}>‹</button>
              <span className="flex-1 text-center text-[15px] font-semibold text-foreground">{title}</span>
              <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); } else setViewMonth(m => m + 1); }} className={scheduleCalendarNavButtonClass}>›</button>
              <button type="button" onClick={() => setViewYear(v => v + 1)} className={scheduleCalendarNavButtonClass}>»</button>
            </div>
            {/* Weekday header */}
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[13px] font-medium text-muted-foreground">
              {['一', '二', '三', '四', '五', '六', '日'].map(w => <span key={w}>{w}</span>)}
            </div>
            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {calendarCells.map((cell, i) => {
                const cellStr = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
                const isSelected = cellStr === onceDate;
                const isToday = cellStr === todayStr;
                const isPast = cell.date < todayDate && !isToday;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isPast}
                    onClick={() => selectDate(cell.date)}
                    className={cn(
                      'flex h-[34px] items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                      !cell.inMonth && 'text-muted-foreground/70',
                      isPast && 'cursor-not-allowed text-muted-foreground/70 opacity-72',
                      !isPast && !isSelected && scheduleCalendarDayHoverClass,
                      isSelected && 'bg-primary font-semibold text-primary-foreground',
                      isToday && !isSelected && 'text-primary ring-1 ring-inset ring-primary',
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            {/* Today button */}
            <div className="mt-2.5 border-t border-border pt-2.5 text-center">
              <button
                type="button"
                onClick={goToday}
                className={cn('rounded-md px-3 py-1 text-sm font-medium transition-colors', scheduleCalendarDayHoverClass)}
              >
                今天
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 每月日期选择器（7列 grid） ─────────────────────────────────────────────
function MonthDayPicker({
  monthDay,
  onChange,
  onOpenChange,
}: {
  monthDay: number;
  onChange: (d: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dir = useDropdownDirection(ref, open);
  const displayLabel = `${monthDay} 号`;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={cn(schedulePickerTriggerClass, 'tabular-nums', open ? formFieldOpenClass : 'border-border')}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="shrink-0 text-muted-foreground"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className={cn(dir === 'up' ? 'absolute bottom-[calc(100%+6px)] left-0 z-20' : 'absolute top-[calc(100%+6px)] left-0 z-20', 'w-[min(280px,calc(100vw-48px))]')}>
          <div className={cn(schedulePickerDropdownPanelClass, 'grid grid-cols-7 gap-1 p-3')}>
            {MONTH_DAYS.map(d => {
              const selected = d === monthDay;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => { onChange(d); setOpen(false); onOpenChange(false); }}
                  className={cn(
                    'flex h-[34px] items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                    selected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : scheduleCalendarDayHoverClass,
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 时间选择器（双列） ─────────────────────────────────────────────────────
function TimePicker({
  time,
  onChange,
  onOpenChange,
}: {
  time: string;
  onChange: (t: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dir = useDropdownDirection(ref, open);
  const [hour, minute] = time.split(':');
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, onOpenChange]);

  // 打开时滚动到选中项
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (hourRef.current) {
          const el = hourRef.current.querySelector(`[data-value="${hour}"]`) as HTMLElement;
          if (el) el.scrollIntoView({ block: 'center' });
        }
        if (minuteRef.current) {
          const el = minuteRef.current.querySelector(`[data-value="${minute}"]`) as HTMLElement;
          if (el) el.scrollIntoView({ block: 'center' });
        }
      }, 10);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectHour(h: string) {
    onChange(`${h}:${minute}`);
  }

  function selectMinute(m: string) {
    onChange(`${hour}:${m}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={cn(schedulePickerTriggerClass, 'tabular-nums', open ? formFieldOpenClass : 'border-border')}
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className="shrink-0 text-muted-foreground"><ClockIcon /></span>
          {time}
        </span>
        <span className="shrink-0 text-muted-foreground"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className={cn(dropdownPositionClassRight(dir), 'min-w-[200px]')}>
          <div className={cn(schedulePickerDropdownPanelClass, 'flex overflow-hidden')}>
            {/* Hour column */}
            <div ref={hourRef} className="scrollbar-thin max-h-[228px] min-w-0 flex-1 overflow-y-auto px-1 py-1.5">
              {HOURS.map(h => {
                const selected = h === hour;
                return (
                  <button
                    key={h}
                    type="button"
                    data-value={h}
                    onClick={() => selectHour(h)}
                    className={cn(
                      'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm tabular-nums',
                      dropdownOptionClass(selected),
                    )}
                  >
                    <span>{h}</span>
                    <span className={cn('flex h-4 w-4 shrink-0 text-primary', !selected && 'opacity-0')}>
                      <Check className="h-4 w-4" />
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Divider */}
            <div className="w-px bg-border" />
            {/* Minute column */}
            <div ref={minuteRef} className="scrollbar-thin max-h-[228px] min-w-0 flex-1 overflow-y-auto px-1 py-1.5">
              {MINUTES.map(m => {
                const selected = m === minute;
                return (
                  <button
                    key={m}
                    type="button"
                    data-value={m}
                    onClick={() => selectMinute(m)}
                    className={cn(
                      'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm tabular-nums',
                      dropdownOptionClass(selected),
                    )}
                  >
                    <span>{m}</span>
                    <span className={cn('flex h-4 w-4 shrink-0 text-primary', !selected && 'opacity-0')}>
                      <Check className="h-4 w-4" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SchedulePicker 主组件 ─────────────────────────────────────────────────
export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
   
  const [_, setAnyOpen] = useState(false);
  const handleOpenChange = useCallback((_open: boolean) => {
    setAnyOpen(_open);
  }, []);

  function update(partial: Partial<ScheduleValue>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className="flex flex-nowrap items-stretch gap-2.5 w-full">
      {/* 频率：固定 1/3 宽 */}
      <div className="flex-[0_0_33.333%] w-1/3 max-w-[33.333%] min-w-0">
        <FrequencyPicker
          value={value.frequency}
          onChange={(freq) => update({ frequency: freq })}
          onOpenChange={handleOpenChange}
        />
      </div>

      {/* 一次性日期（仅 frequency=once） */}
      {value.frequency === 'once' && (
        <div className="flex-1 min-w-0">
          <OnceDatePicker
            onceDate={value.onceDate}
            onChange={(d) => update({ onceDate: d })}
            onOpenChange={handleOpenChange}
          />
        </div>
      )}

      {/* 星期多选（仅 frequency=weekly） */}
      {value.frequency === 'weekly' && (
        <div className="flex-1 min-w-0">
          <WeekdaysPicker
            weekDays={value.weekDays}
            onChange={(days) => update({ weekDays: days })}
            onOpenChange={handleOpenChange}
          />
        </div>
      )}

      {/* 每月日期（仅 frequency=monthly） */}
      {value.frequency === 'monthly' && (
        <div className="flex-1 min-w-0">
          <MonthDayPicker
            monthDay={value.monthDay ?? 1}
            onChange={(d) => update({ monthDay: d })}
            onOpenChange={handleOpenChange}
          />
        </div>
      )}

      {/* 时间选择器：始终显示 */}
      <div className="flex-1 min-w-0">
        <TimePicker
          time={value.time}
          onChange={(t) => update({ time: t })}
          onOpenChange={handleOpenChange}
        />
      </div>
    </div>
  );
}
