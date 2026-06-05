/**
 * Scheduled Task Natural Language Extractor
 * 
 * 从中文自然语言描述中提取定时任务参数
 * 支持常见的时间表达方式，如"每天早上 9 点"、"每周一上午 10 点"等
 */

export interface ExtractedTaskParams {
  name?: string;
  cronExpr?: string;
  description?: string;
  hasError?: boolean;
  errors?: string[];
}

interface TimeMatch {
  hour: string;
  minute: string;
}

/**
 * 从中文时间描述中提取小时和分钟
 */
function extractTime(text: string): TimeMatch | null {
  // 匹配"9 点"、"09 点"、"9:30"、"09:30"等格式
  const hourMinuteMatch = text.match(/(\d{1,2})[点:：](\d{0,2})/);
  if (hourMinuteMatch) {
    const hour = hourMinuteMatch[1].padStart(2, '0');
    const minute = hourMinuteMatch[2] || '00';
    return { hour, minute: minute.padStart(2, '0') };
  }

  // 匹配"上午 9 点"、"下午 3 点"等格式
  const periodMatch = text.match(/(上午 | 早上 | 中午 | 下午 | 晚上 | 凌晨)(\d{1,2})[点:：]?(\d{0,2})?/);
  if (periodMatch) {
    const period = periodMatch[1];
    let hour = parseInt(periodMatch[2], 10);
    const minute = periodMatch[3] || '00';

    // 处理 12 小时制转换
    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    } else if (period === '上午' || period === '早上' || period === '凌晨') {
      if (hour === 12) hour = 0;
    } else if (period === '中午') {
      hour = 12;
    }

    return {
      hour: hour.toString().padStart(2, '0'),
      minute: minute.padStart(2, '0'),
    };
  }

  return null;
}

/**
 * 从中文描述中提取频率类型
 */
function extractFrequency(text: string): { type: string; weekdays?: number[]; monthDay?: number } | null {
  // 每天
  if (text.includes('每天') || text.includes('每日')) {
    return { type: 'daily' };
  }

  // 工作日（周一到周五）
  if (text.includes('工作日')) {
    return { type: 'weekly', weekdays: [1, 2, 3, 4, 5] };
  }

  // 周末
  if (text.includes('周末')) {
    return { type: 'weekly', weekdays: [0, 6] };
  }

  // 每周一、每周二等
  const weekdayMatch = text.match(/每周 ([一二三四五六日天])/);
  if (weekdayMatch) {
    const weekdayMap: Record<string, number> = {
      '日': 0, '天': 0,
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    };
    return { type: 'weekly', weekdays: [weekdayMap[weekdayMatch[1]]] };
  }

  // 每周一三五、每周二四等
  const multiWeekdayMatch = text.match(/每周 ([一二三四五六日天，,、\s]+)/);
  if (multiWeekdayMatch) {
    const weekdayMap: Record<string, number> = {
      '日': 0, '天': 0,
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    };
    const weekdays = multiWeekdayMatch[1]
      .split(/[，,、\s]+/)
      .map(d => weekdayMap[d])
      .filter(d => d !== undefined);
    if (weekdays.length > 0) {
      return { type: 'weekly', weekdays };
    }
  }

  // 每月 1 日、每月 15 号等
  const monthDayMatch = text.match(/每月 (\d{1,2})[日号]/);
  if (monthDayMatch) {
    const monthDay = parseInt(monthDayMatch[1], 10);
    if (monthDay >= 1 && monthDay <= 31) {
      return { type: 'monthly', monthDay };
    }
  }

  return null;
}

/**
 * 尝试从文本中提取任务名称
 */
function extractTaskName(text: string): string | null {
  // 尝试匹配引号内的内容
  const quoteMatch = text.match(/["']([^"']+)["']/);
  if (quoteMatch && quoteMatch[1].trim()) {
    return quoteMatch[1].trim();
  }

  // 尝试匹配"任务"、"提醒"等关键词前的内容
  const keywordMatch = text.match(/(.+?)(?: 任务 | 提醒 | 通知)/);
  if (keywordMatch && keywordMatch[1].trim().length > 0 && keywordMatch[1].trim().length <= 50) {
    return keywordMatch[1].trim();
  }

  // 尝试匹配动词短语作为任务名（如"生成周报 PPT"）
  const actionMatch = text.match(/(?:请 | 帮我 | 需要 | 要)(.+?)(?: 在 | 于 | 每 | 从)/);
  if (actionMatch && actionMatch[1].trim().length > 0 && actionMatch[1].trim().length <= 50) {
    return actionMatch[1].trim();
  }

  // 如果文本较短，直接作为任务名
  if (text.length <= 30 && text.length > 2) {
    return text.trim();
  }

  return null;
}

/**
 * 将提取的参数转换为 cron 表达式
 */
function buildCronExpr(frequency: { type: string; weekdays?: number[]; monthDay?: number }, time: TimeMatch): string {
  const { hour, minute } = time;

  switch (frequency.type) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      if (frequency.weekdays && frequency.weekdays.length > 0) {
        return `${minute} ${hour} * * ${frequency.weekdays.join(',')}`;
      }
      return `${minute} ${hour} * * *`;
    case 'monthly':
      return `${minute} ${hour} ${frequency.monthDay ?? 1} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

/**
 * 从自然语言描述中提取定时任务参数
 * 
 * @param text - 用户的自然语言描述
 * @returns 提取的参数对象
 */
export function extractScheduledTaskParams(text: string): ExtractedTaskParams {
  const errors: string[] = [];
  const result: ExtractedTaskParams = { description: text.trim() };

  // 1. 提取时间
  const time = extractTime(text);
  if (!time) {
    errors.push('未找到时间信息，请指定具体时间（如"上午 9 点"）');
  }

  // 2. 提取频率
  const frequency = extractFrequency(text);
  if (!frequency) {
    errors.push('未找到频率信息，请指定执行频率（如"每天"、"每周一"、"每月 1 日"）');
  }

  // 3. 提取任务名称
  const name = extractTaskName(text);
  if (!name) {
    errors.push('未找到任务名称，请描述任务内容');
  }
  result.name = name || undefined;

  // 4. 构建 cron 表达式
  if (time && frequency) {
    result.cronExpr = buildCronExpr(frequency, time);
  }

  // 5. 设置错误状态
  if (errors.length > 0) {
    result.hasError = true;
    result.errors = errors;
  }

  return result;
}

/**
 * 验证提取的参数是否完整
 */
export function validateTaskParams(params: ExtractedTaskParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.name || params.name.trim().length === 0) {
    errors.push('任务名称不能为空');
  }

  if (!params.cronExpr) {
    errors.push('cron 表达式不能为空');
  } else {
    // 简单验证 cron 表达式格式
    const parts = params.cronExpr.split(' ');
    if (parts.length !== 5) {
      errors.push('cron 表达式格式不正确');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
