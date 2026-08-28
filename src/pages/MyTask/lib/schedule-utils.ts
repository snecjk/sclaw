/** 与 SchedulePicker 共用的计划值（不含 once） */
export interface ScheduleValue {
  frequency: 'daily' | 'weekly' | 'monthly';
  weekDays: number[];
  monthDays: number[];
  monthLastDay?: boolean;
  times: string[];
}

/** 完整计划值类型（含 once，用于 MyTask 页面的任务调度） */
export interface ScheduleValueFull {
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  onceDate?: string;
  weekDays: number[];
  monthDays: number[];
  monthLastDay?: boolean;
  times: string[];
}

/** @deprecated 使用 ScheduleValue */
export type ScheduleValueCompat = ScheduleValue;

/** UI 最多允许添加的离散时刻数；解码超过此数视为无法在 Picker 中完整表达 */
export const MAX_SCHEDULE_TIMES = 12;

export type TimesEncodeError = 'empty';
export type MonthDaysEncodeError = 'empty';

export function parseTimeParts(time: string): { hour: number; minute: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatHhMm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeTimes(times: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const time of times) {
    const parts = parseTimeParts(time);
    if (!parts) continue;
    const key = formatHhMm(parts.hour, parts.minute);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.sort();
}

export function splitCronExprParts(expr: string): string[] {
  return expr
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 解析 cron 分钟/小时字段中的列表与简单 a-b 区间。
 * `*`、步进（含 `/`）返回 null，表示无法展开为离散时刻。
 */
export function parseCronListField(field: string, min: number, max: number): number[] | null {
  if (!field || field === '*' || field.includes('/') || field.includes('?')) return null;
  const values = new Set<number>();
  for (const raw of field.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    if (token.includes('-')) {
      const [startRaw, endRaw] = token.split('-');
      const start = parseInt(startRaw, 10);
      const end = parseInt(endRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
      if (start < min || end > max) return null;
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      const n = parseInt(token, 10);
      if (!Number.isFinite(n) || n < min || n > max) return null;
      values.add(n);
    }
  }
  if (values.size === 0) return null;
  return [...values].sort((a, b) => a - b);
}

export interface ParsedMonthDayField {
  days: number[];
  lastDay: boolean;
}

/** 解析 DOM 字段：数字/区间 + 可选 `L`（月末）。含步进、W、# 时返回 null。 */
export function parseMonthDayField(field: string): ParsedMonthDayField | null {
  if (!field || field === '*' || /[/#?W]/i.test(field)) return null;
  const tokens = field.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  let lastDay = false;
  const numeric: string[] = [];
  for (const token of tokens) {
    if (token.toUpperCase() === 'L') {
      lastDay = true;
      continue;
    }
    numeric.push(token);
  }
  if (numeric.length === 0) {
    return lastDay ? { days: [], lastDay: true } : null;
  }
  const days = parseCronListField(numeric.join(','), 1, 31);
  if (!days) return null;
  return { days, lastDay };
}

export function normalizeMonthDays(days: number[] | undefined): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const day of days ?? []) {
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    if (seen.has(day)) continue;
    seen.add(day);
    out.push(day);
  }
  return out.sort((a, b) => a - b);
}

export function validateScheduleMonthDays(
  value: Pick<ScheduleValue, 'monthDays' | 'monthLastDay'>,
): MonthDaysEncodeError | null {
  return normalizeMonthDays(value.monthDays).length === 0 && !value.monthLastDay ? 'empty' : null;
}

function monthDomField(value: ScheduleValue | ScheduleValueFull): string {
  const days = normalizeMonthDays(value.monthDays);
  const lastDay = Boolean(value.monthLastDay);
  if (days.length === 0 && !lastDay) return '1';
  if (days.length === 0) return 'L';
  if (!lastDay) return days.join(',');
  return `${days.join(',')},L`;
}

/** 分钟 × 小时笛卡尔积 → HH:mm 列表；无法离散展开时返回 null */
export function cronFieldsToTimes(minField: string, hourField: string): string[] | null {
  const minutes = parseCronListField(minField, 0, 59);
  const hours = parseCronListField(hourField, 0, 23);
  if (!minutes || !hours) return null;
  const times: string[] = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      times.push(formatHhMm(hour, minute));
    }
  }
  if (times.length === 0 || times.length > MAX_SCHEDULE_TIMES) return null;
  return times;
}

export function validateScheduleTimes(times: string[]): TimesEncodeError | null {
  return normalizeTimes(times).length === 0 ? 'empty' : null;
}

/** 「添加时间」默认值：上一时刻 +1 小时、同一分钟 */
export function nextSuggestedTime(times: string[]): string {
  const normalized = normalizeTimes(times);
  const last = normalized[normalized.length - 1] ?? '09:00';
  const parsed = parseTimeParts(last) ?? { hour: 9, minute: 0 };
  const existing = new Set(normalized);
  for (let step = 1; step <= 24; step++) {
    const candidate = formatHhMm((parsed.hour + step) % 24, parsed.minute);
    if (!existing.has(candidate)) return candidate;
  }
  return last;
}

function resolveTimes(value: ScheduleValue | ScheduleValueFull): string[] {
  if (Array.isArray(value.times) && value.times.length > 0) return value.times;
  return ['09:00'];
}

function cronForTime(
  value: ScheduleValue | ScheduleValueFull,
  minute: number,
  hour: number,
): string {
  const m = String(minute);
  const h = String(hour);
  switch (value.frequency) {
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly': {
      const days = value.weekDays;
      if (days.length === 0 || days.length === 7) return `${m} ${h} * * *`;
      return `${m} ${h} * * ${days.join(',')}`;
    }
    case 'monthly':
      return `${m} ${h} ${monthDomField(value)} * *`;
    default:
      return `${m} ${h} * * *`;
  }
}

export function scheduleValueToCron(value: ScheduleValue | ScheduleValueFull): string {
  const times = normalizeTimes(resolveTimes(value)).slice(0, MAX_SCHEDULE_TIMES);
  if (times.length === 0) {
    throw new Error('Cannot encode schedule times: empty');
  }
  return times
    .map((time) => {
      const parts = parseTimeParts(time);
      if (!parts) throw new Error('Cannot encode schedule times: empty');
      return cronForTime(value, parts.minute, parts.hour);
    })
    .join(';');
}

function withTimes(
  base: Omit<ScheduleValue, 'times'>,
  minField: string,
  hourField: string,
): ScheduleValue | null {
  const times = cronFieldsToTimes(minField, hourField);
  if (!times) return null;
  return { ...base, times };
}

function monthDayKeys(value: ScheduleValue): string[] {
  const keys = normalizeMonthDays(value.monthDays).map((day) => `d:${day}`);
  if (value.monthLastDay) keys.push('L');
  return keys;
}

function expandPartCells(value: ScheduleValue): { times: string[]; dayKeys: string[] } | null {
  const times = normalizeTimes(value.times);
  if (times.length === 0) return null;
  if (value.frequency === 'monthly') {
    const dayKeys = monthDayKeys(value);
    return dayKeys.length > 0 ? { times, dayKeys } : null;
  }
  if (value.frequency === 'weekly') {
    const dayKeys = [...new Set(value.weekDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      .sort((a, b) => a - b)
      .map(String);
    return dayKeys.length > 0 ? { times, dayKeys } : null;
  }
  return { times, dayKeys: ['*'] };
}

/**
 * Picker 只能表达「时刻 × 日期」的完整笛卡尔积。
 * 多段只要铺满该矩形（例如按日拆开、时刻相同）就可以合并；缺格则无法无损回填。
 */
function mergeParsedParts(parsed: ScheduleValue[]): ScheduleValue | null {
  const first = parsed[0];
  if (!first || parsed.some((part) => part.frequency !== first.frequency)) return null;

  const allTimes = new Set<string>();
  const allDayKeys = new Set<string>();
  const pairs = new Set<string>();
  for (const part of parsed) {
    const cells = expandPartCells(part);
    if (!cells) return null;
    for (const time of cells.times) allTimes.add(time);
    for (const dayKey of cells.dayKeys) allDayKeys.add(dayKey);
    for (const time of cells.times) {
      for (const dayKey of cells.dayKeys) pairs.add(`${time}|${dayKey}`);
    }
  }

  const times = normalizeTimes([...allTimes]);
  if (times.length === 0 || times.length > MAX_SCHEDULE_TIMES) return null;
  if (pairs.size !== times.length * allDayKeys.size) return null;

  if (first.frequency === 'monthly') {
    const monthDays = normalizeMonthDays(
      [...allDayKeys]
        .filter((key) => key.startsWith('d:'))
        .map((key) => Number(key.slice(2))),
    );
    const monthLastDay = allDayKeys.has('L');
    if (monthDays.length === 0 && !monthLastDay) return null;
    return {
      frequency: 'monthly',
      weekDays: [1, 2, 3, 4, 5],
      monthDays,
      monthLastDay,
      times,
    };
  }
  if (first.frequency === 'weekly') {
    const weekDays = [...allDayKeys]
      .map((key) => Number(key))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);
    if (weekDays.length === 0) return null;
    return {
      frequency: 'weekly',
      weekDays,
      monthDays: [1],
      times,
    };
  }
  return {
    frequency: 'daily',
    weekDays: [1, 2, 3, 4, 5],
    monthDays: [1],
    times,
  };
}

function parseWeekDaysField(weekday: string): number[] | null {
  const raw = parseCronListField(weekday, 0, 7);
  if (!raw) return null;
  const days = [...new Set(raw.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
  return days.length > 0 ? days : null;
}

function parseSingleFiveField(cron: string): ScheduleValue | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, day, month, weekday] = parts;
  if (month !== '*') return null;
  if (weekday !== '*' && day !== '*') return null;

  if (weekday !== '*' && day === '*') {
    const days = parseWeekDaysField(weekday);
    if (!days) return null;
    return withTimes({ frequency: 'weekly', weekDays: days, monthDays: [1] }, min, hour);
  }
  if (day !== '*') {
    const parsed = parseMonthDayField(day);
    if (!parsed) return null;
    return withTimes(
      {
        frequency: 'monthly',
        weekDays: [1, 2, 3, 4, 5],
        monthDays: parsed.days,
        monthLastDay: parsed.lastDay,
      },
      min,
      hour,
    );
  }
  return withTimes({ frequency: 'daily', weekDays: [1, 2, 3, 4, 5], monthDays: [1] }, min, hour);
}

/**
 * 将 cron 无损展开为 SchedulePicker 模型。
 * 无法完整表达时返回 null（步进、通配、超 12 个时刻、多段无法铺满时刻×日期矩形等），
 * 调用方应保留原 cron，禁止静默回退后再编码保存。
 */
export function tryCronToScheduleValue(cron: string | unknown): ScheduleValue | null {
  if (typeof cron !== 'string') {
    if (cron && typeof cron === 'object') {
      const s = cron as { kind?: string; expr?: string };
      if (s.kind === 'cron' && typeof s.expr === 'string') {
        return tryCronToScheduleValue(s.expr);
      }
    }
    return null;
  }

  const exprParts = splitCronExprParts(cron);
  if (exprParts.length === 0 || exprParts.length > MAX_SCHEDULE_TIMES) return null;

  const parsed: ScheduleValue[] = [];
  for (const part of exprParts) {
    const value = parseSingleFiveField(part);
    if (!value) return null;
    parsed.push(value);
  }

  return mergeParsedParts(parsed);
}

/** 展示用便捷解码；无法展开时回退默认。编辑回填请用 tryCronToScheduleValue。 */
export function cronToScheduleValue(cron: string | unknown): ScheduleValue {
  return tryCronToScheduleValue(cron) ?? defaultScheduleValue();
}

export function defaultScheduleValue(): ScheduleValue {
  return {
    frequency: 'daily',
    times: ['09:00'],
    weekDays: [1, 2, 3, 4, 5],
    monthDays: [1],
  };
}
