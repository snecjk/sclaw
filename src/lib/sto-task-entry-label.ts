/** Local calendar YYYY-MM-DD for "click instant" (not UTC). */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatMaterialDateFromEntryId(entryId: string, language: string): string {
  const [ys, ms, ds] = entryId.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const day = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return entryId;
  const dt = new Date(y, m - 1, day);
  const locale =
    language === 'zh' || language.startsWith('zh') ? 'zh-CN' : language === 'ja' || language.startsWith('ja') ? 'ja-JP' : 'en-US';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(dt);
}
