import { Cron } from 'croner';

/**
 * Cron 数学（croner 包装）。
 *
 * 替代旧 `claude-task-scheduler` / `scheduled-task-scheduler` 两份逐字重复的
 * 自研实现。行为契约保持不变：
 * - 5 字段强制（拒 3/4/6 字段），区间越界 throw；
 * - 永不命中（如 `0 9 31 2 *` Feb 31）throw scan-horizon；
 * - host-local 时区（不传 `timezone`，与旧 `getHours()` 一致）。
 *   表字段 `next_run_at` / `created_at` 存 UTC ISO（`Date#toISOString`），
 *   这只是存储格式：cron 五段按本机墙钟匹配，再把那个瞬间写成 UTC。
 *   自然创建与手动创建走同一条 `computeNextRunAt`，不会因 UTC 存储而平移触发时刻；
 *   「立即执行」不走 cron，用当前瞬间的 UTC ISO 作为 `scheduled_for`。
 * - DOM/DOW Vixie OR（`domAndDow` 默认 false）；
 * - `nextRun(from)` 排他（严格晚于 from），等价旧 `roundUpToNextMinute(from)`+扫描。
 * - 支持 `;` 拼接的多条 5 段（一天多个独立时刻）；`next_run_at` 取各段最早命中。
 *
 * 错误文案保持 3 条契约子串（`/5-field cron/`、`/Invalid cron/`、`/scan horizon/`），
 * 供 UI（`scheduled-task-service` 不 catch，错误直达 IPC→前端）与测试断言稳定。
 */

/** 与 UI `MAX_SCHEDULE_TIMES` 对齐 */
export const MAX_CRON_EXPR_PARTS = 12;

/** 将 `cron_expr` 拆成若干条 5 段；`;` 分隔，trim 后丢掉空段。 */
export function splitCronExprs(expr: string): string[] {
  return expr
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function validateSingleCronExpr(part: string): void {
  const fields = part.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5-field cron expression, received: ${part}`);
  }
  let cron: Cron;
  try {
    cron = new Cron(part, { mode: '5-part' });
  } catch (err) {
    throw new Error(`Invalid cron range or step in "${part}": ${(err as Error).message}`);
  }
  if (cron.nextRun(new Date()) === null) {
    throw new Error(`Could not find next run time within scan horizon for cron: ${part}`);
  }
}

/** 5 字段强校验：格式 + 区间 + 地平线内确有命中。非法 throw。支持 `;` 多段。 */
export function validateCronExpr(expr: string): void {
  if (typeof expr !== 'string' || expr.trim() === '') {
    throw new Error('Invalid cron expression: empty');
  }
  const parts = splitCronExprs(expr);
  if (parts.length === 0) {
    throw new Error('Invalid cron expression: empty');
  }
  if (parts.length > MAX_CRON_EXPR_PARTS) {
    throw new Error(`Invalid cron: too many expressions (max ${MAX_CRON_EXPR_PARTS})`);
  }
  for (const part of parts) {
    validateSingleCronExpr(part);
  }
}

/**
 * 计算从 `from` 之后首个 cron 命中时刻（UTC ISO）。
 * 多段时取各段 nextRun 的最早值。
 * 匹配用本机时区；`toISOString()` 只把该瞬间序列化成 UTC，不改墙钟。
 * croner `nextRun` 排他语义等价旧 `roundUpToNextMinute(from)`+扫描，无需额外 round-up。
 */
export function computeNextRunAt(expr: string, from: Date = new Date()): string {
  validateCronExpr(expr);
  let earliest: Date | null = null;
  for (const part of splitCronExprs(expr)) {
    const next = new Cron(part, { mode: '5-part' }).nextRun(from);
    if (next === null) {
      throw new Error(`Could not find next run time within scan horizon for cron: ${part}`);
    }
    if (earliest === null || next.getTime() < earliest.getTime()) {
      earliest = next;
    }
  }
  if (earliest === null) {
    throw new Error(`Could not find next run time within scan horizon for cron: ${expr}`);
  }
  return earliest.toISOString();
}
