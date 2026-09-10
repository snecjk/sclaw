/**
 * 移动端响应式体检脚本（T11）。
 * 经 executeJS 运行，返回 JSON 结果。
 */
export const RESPONSIVE_AUDIT_SCRIPT = `(function(){
  var overflows = [];
  var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  var all = document.body ? document.body.querySelectorAll('*') : [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    try {
      if (el.scrollWidth > el.clientWidth + 1 && el.scrollWidth > vw + 1) {
        var tag = (el.tagName || '').toLowerCase();
        var id = el.id ? '#' + el.id : '';
        var cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
          : '';
        overflows.push({
          selector: tag + id + cls,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        });
      }
    } catch (e) {}
    if (overflows.length >= 12) break;
  }
  overflows.sort(function(a, b){ return (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth); });
  var top = overflows.slice(0, 3);
  var meta = document.querySelector('meta[name="viewport"]');
  var hasViewport = Boolean(meta && (meta.getAttribute('content') || '').trim());
  var docOverflow = (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    || (document.body && document.body.scrollWidth > document.body.clientWidth + 2);
  return {
    ok: top.length === 0 && hasViewport && !docOverflow,
    hasViewport: hasViewport,
    docOverflow: Boolean(docOverflow),
    overflowCount: overflows.length,
    topOverflows: top
  };
})()`;

export interface AppDevResponsiveAuditResult {
  ok: boolean;
  hasViewport: boolean;
  docOverflow: boolean;
  overflowCount: number;
  topOverflows: Array<{ selector: string; scrollWidth: number; clientWidth: number }>;
}

export function formatResponsiveAuditSummary(result: AppDevResponsiveAuditResult): string {
  if (result.ok) return '移动端体检：✓ 通过';
  const parts: string[] = [];
  if (!result.hasViewport) parts.push('缺 viewport meta');
  if (result.overflowCount > 0) parts.push(`${result.overflowCount} 处溢出`);
  else if (result.docOverflow) parts.push('文档横向溢出');
  return `移动端体检：⚠ ${parts.join(' · ') || '未通过'}`;
}

export function buildResponsiveFixPrompt(result: AppDevResponsiveAuditResult): string {
  const lines = [
    '请修复移动端响应式问题：',
    !result.hasViewport ? '- 缺少 viewport meta，请在 index.html 补齐' : null,
    result.docOverflow ? '- 文档根节点存在横向溢出' : null,
    ...result.topOverflows.map(
      (item, i) => `- 溢出 ${i + 1}：\`${item.selector}\`（scrollWidth=${item.scrollWidth}, clientWidth=${item.clientWidth}）`,
    ),
    '要求：≥390px 宽度无横向滚动，优先用现有 theme token，禁止硬编码宽色值。',
  ].filter(Boolean);
  return lines.join('\n');
}
