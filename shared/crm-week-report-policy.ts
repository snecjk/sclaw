/**
 * CRM 周报策略白名单：SSO userName 与策略接口 data[].userCode 比对（shared，供 Main 与单测复用）。
 */

/**
 * 从策略接口 JSON 体解析是否允许展示 CRM 周报首页表面。
 * `ssoUserName` 与各条 `userCode` 均经 `String(...).trim()` 后做 **大小写敏感** 严格相等。
 */
export function computeCrmWeekReportSurfaceAllowed(
  ssoUserName: string | undefined | null,
  payload: unknown,
): boolean {
  if (ssoUserName == null) return false;
  const sso = String(ssoUserName).trim();
  if (!sso) return false;
  if (payload == null || typeof payload !== 'object') return false;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return false;
  for (const item of data) {
    if (item == null || typeof item !== 'object') continue;
    const raw = (item as Record<string, unknown>).userCode;
    if (raw === undefined || raw === null) continue;
    const entry = String(raw).trim();
    if (entry === sso) return true;
  }
  return false;
}
