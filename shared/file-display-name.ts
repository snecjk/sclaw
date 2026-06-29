/** Score how display-friendly a filename is (prefer CJK labels over mojibake). */
export function displayNameScore(fileName: string): number {
  const name = fileName.trim();
  if (!name) return 0;
  let score = 0;
  if (/[\u4e00-\u9fff]/.test(name)) score += 100;
  if (/[\uFFFD]/.test(name)) score -= 80;
  const cjkCount = (name.match(/[\u4e00-\u9fff]/g) ?? []).length;
  score += cjkCount * 2;
  return score + name.length;
}

export function preferDisplayFileName(primary: string, secondary: string): string {
  const a = primary.trim();
  const b = secondary.trim();
  if (!a) return b;
  if (!b) return a;
  return displayNameScore(a) >= displayNameScore(b) ? a : b;
}

export function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.trim() || 'file';
}

/** Prefer explicit display label, then path basename. */
export function resolveAttachedFileName(filePath: string, explicitName?: string): string {
  const label = explicitName?.trim();
  const base = basenameFromPath(filePath);
  if (!label) return base;
  return preferDisplayFileName(label, base);
}

/** Date-stamped suffix shared by garbled/correct variants, e.g. `_20260625.xlsx`. */
export function stableFileSuffix(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop()?.toLowerCase() || '';
  const match = base.match(/(_\d{8}\.[a-z0-9]+)$/i);
  return match?.[1] ?? null;
}
