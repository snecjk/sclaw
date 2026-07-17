import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ScheduleValue {
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  onceDate?: string;
  weekDays: number[];     // 多选星期: 0=周日, 1=周一
  monthDay?: number;      // 1-31
  time: string;           // "HH:mm"
}

const FREQUENCY_OPTIONS = [
  { value: 'daily' as const, label: '每天' },
  { value: 'weekly' as const, label: '每周' },
  { value: 'monthly' as const, label: '每月' },
];

const WEEKDAY_FULL_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

// 下拉中显示的选项（可多选），去掉"每天"和"工作日"快捷选项
const WEEKDAY_DROPDOWN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
];

interface SchedulePickerProps {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const [freqOpen, setFreqOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const weekRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (weekRef.current && !weekRef.current.contains(e.target as Node)) {
        setWeekOpen(false);
      }
    }
    if (weekOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [weekOpen]);

  // 频率下拉显示标签
  const freqDisplayLabel = useMemo(() => {
    if (value.frequency !== 'weekly') {
      return FREQUENCY_OPTIONS.find(o => o.value === value.frequency)?.label || '每天';
    }
    const days = value.weekDays;
    if (days.length === 7) return '每天';
    if (days.length === 5 && days.every(d => [1, 2, 3, 4, 5].includes(d))) return '工作日';
    return '每周';
  }, [value.frequency, value.weekDays]);

  // 星期下拉显示标签
  const weekDisplayLabel = useMemo(() => {
    const days = value.weekDays;
    if (days.length === 7) return '每天';
    if (days.length === 5 && days.every(d => [1, 2, 3, 4, 5].includes(d))) return '工作日';
    if (days.length === 0) return '请选择';
    return days
      .slice()
      .sort((a, b) => a - b)
      .map(d => WEEKDAY_FULL_LABELS[d])
      .join('、');
  }, [value.weekDays]);

  const freqValue = value.frequency;
  const showWeekDays = value.frequency === 'weekly';

  // 时间选项
  const timeOptions = useMemo(() => {
    const opts: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return opts;
  }, []);

  function update(partial: Partial<ScheduleValue>) {
    onChange({ ...value, ...partial });
  }

  function toggleWeekDay(day: number) {
    const current = value.weekDays;
    const next = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => a - b);
    update({ weekDays: next });
  }

  function handleWeekOptionClick(optValue: number) {
    toggleWeekDay(optValue);
  }

  function isWeekOptionChecked(optValue: number): boolean {
    return value.weekDays.includes(optValue);
  }

  return (
    <div className="space-y-4">
      {/* Row: Frequency + WeekDropdown + Date/Month + Time */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Frequency Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFreqOpen(!freqOpen)}
            className="flex items-center gap-2 h-10 px-3 text-[13px] rounded-lg border border-border bg-background text-foreground hover:bg-muted/30 transition-colors"
          >
            <span>{freqDisplayLabel}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", freqOpen && "rotate-180")} />
          </button>
          {freqOpen && (
            <div className="absolute left-0 top-full mt-1 w-28 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    update({ frequency: opt.value });
                    setFreqOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-[13px] transition-colors",
                    freqValue === opt.value ? "text-primary bg-primary/5 font-medium" : "text-foreground hover:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Weekday Multi-select Dropdown (only for weekly) */}
        {showWeekDays && (
          <div className="relative" ref={weekRef}>
            <button
              type="button"
              onClick={() => setWeekOpen(!weekOpen)}
              className={cn(
                "flex items-center gap-2 h-10 px-3 text-[13px] rounded-lg border bg-background transition-colors min-w-[120px]",
                value.weekDays.length === 0
                  ? "border-border text-muted-foreground hover:bg-muted/30"
                  : "border-border text-foreground hover:bg-muted/30"
              )}
            >
              <span className="truncate">{weekDisplayLabel}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform ml-auto shrink-0", weekOpen && "rotate-180")} />
            </button>
            {weekOpen && (
              <div className="absolute left-0 top-full mt-1 w-36 bg-background border border-border rounded-lg shadow-lg py-1 z-50">
                {WEEKDAY_DROPDOWN_OPTIONS.map((opt) => {
                  const checked = isWeekOptionChecked(opt.value);
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => handleWeekOptionClick(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors",
                        checked ? "text-primary bg-primary/5" : "text-foreground hover:bg-muted"
                      )}
                    >
                      <span className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                        checked ? "bg-primary border-primary" : "border-border bg-background"
                      )}>
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Once date picker */}
        {value.frequency === 'once' && (
          <input
            type="date"
            value={value.onceDate || ''}
            onChange={(e) => update({ onceDate: e.target.value })}
            className="h-10 px-3 text-[13px] rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        )}

        {/* Monthly day picker */}
        {value.frequency === 'monthly' && (
          <div className="relative">
            <select
              value={value.monthDay ?? 1}
              onChange={(e) => update({ monthDay: Number(e.target.value) })}
              className="h-10 px-3 pr-8 text-[13px] rounded-lg border border-border bg-background appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer"
            >
              {MONTH_DAYS.map(d => (
                <option key={d} value={d}>{d} 号</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        )}

        {/* Time Picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setTimeOpen(!timeOpen)}
            className="flex items-center gap-2 h-10 px-3 text-[13px] rounded-lg border border-border bg-background text-foreground hover:bg-muted/30 transition-colors"
          >
            <ClockIcon />
            <span>{value.time}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", timeOpen && "rotate-180")} />
          </button>
          {timeOpen && (
            <div className="absolute left-0 top-full mt-1 w-28 max-h-48 overflow-y-auto bg-background border border-border rounded-lg shadow-lg z-50">
              {timeOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { update({ time: t }); setTimeOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[13px] transition-colors",
                    value.time === t ? "text-primary bg-primary/5 font-medium" : "text-foreground hover:bg-muted"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
