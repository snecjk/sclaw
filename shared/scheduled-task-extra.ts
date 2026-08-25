/**
 * 定时任务 extra 浅合并：覆盖 composer 字段时保留 createdVia 及其它未知键。
 * 仓库层 extra_json 是整包替换，调用方必须先 merge 再写入。
 */
export function mergeScheduledTaskExtra(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' ? existing : {};
  return { ...base, ...incoming };
}
