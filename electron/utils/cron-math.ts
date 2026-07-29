import { Cron } from 'croner';

/**
 * Cron 数学（croner 包装）。
 *
 * 替代旧 `claude-task-scheduler` / `scheduled-task-scheduler` 两份逐字重复的
 * 自研实现。行为契约保持不变：
 * - 5 字段强制（拒 3/4/6 字段），区间越界 throw；
 * - 永不命中（如 `0 9 31 2 *` Feb 31）throw scan-horizon；
 * - host-local 时区（不传 `timezone`，与旧 `getHours()` 一致）；
 * - DOM/DOW Vixie OR（`domAndDow` 默认 false）；
 * - `nextRun(from)` 排他（严格晚于 from），等价旧 `roundUpToNextMinute(from)`+扫描。
 *
 * 错误文案保持 3 条契约子串（`/5-field cron/`、`/Invalid cron/`、`/scan horizon/`），
 * 供 UI（`scheduled-task-service` 不 catch，错误直达 IPC→前端）与测试断言稳定。
 */

/** 5 字段强校验：格式 + 区间 + 地平线内确有命中。非法 throw。 */
export function validateCronExpr(expr: string): void {
  if (typeof expr !== 'string' || expr.trim() === '') {
    throw new Error('Invalid cron expression: empty');
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected 5-field cron expression, received: ${expr}`);
  }
  let cron: Cron;
  try {
    cron = new Cron(expr, { mode: '5-part' });
  } catch (err) {
    // croner: "CronPattern: Invalid value for minute: 60" 等。归一为 "Invalid cron..."
    // 前缀以稳定 UI 错误文案与测试契约（/Invalid cron/）。
    throw new Error(`Invalid cron range or step in "${expr}": ${(err as Error).message}`);
  }
  if (cron.nextRun(new Date()) === null) {
    throw new Error(`Could not find next run time within scan horizon for cron: ${expr}`);
  }
}

/**
 * 计算从 `from` 之后首个 cron 命中时刻（ISO）。
 * croner `nextRun` 排他语义等价旧 `roundUpToNextMinute(from)`+扫描，无需额外 round-up。
 */
export function computeNextRunAt(expr: string, from: Date = new Date()): string {
  validateCronExpr(expr);
  const next = new Cron(expr, { mode: '5-part' }).nextRun(from);
  if (next === null) {
    throw new Error(`Could not find next run time within scan horizon for cron: ${expr}`);
  }
  return next.toISOString();
}
