/**
 * CRM 周报策略白名单：SSO code（优先）或 userName 与策略接口 data[].userCode 比对（shared，供 Main 与单测复用）。
 */

function matchAny(needle: string, data: unknown[]): boolean {
  for (const item of data) {
    if (item == null || typeof item !== 'object') continue;
    const raw = (item as Record<string, unknown>).userCode;
    if (raw === undefined || raw === null) continue;
    const entry = String(raw).trim();
    if (entry === needle) return true;
  }
  return false;
}

/**
 * 从策略接口 JSON 体解析是否允许展示 CRM 周报首页表面。
 * 优先使用 `ssoCode`（梧桐工号）与 `data[].userCode` 比对；若无命中或 `ssoCode` 为空，
 * 则以 `ssoUserName` 做兜底比对。均经 `String(...).trim()` 后做 **大小写敏感** 严格相等。
 */
export function computeCrmWeekReportSurfaceAllowed(
  ssoCode: string | undefined | null,
  ssoUserName: string | undefined | null,
  payload: unknown,
): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return false;

  if (ssoCode != null) {
    const code = String(ssoCode).trim();
    if (code && matchAny(code, data)) return true;
  }

  if (ssoUserName == null) return false;
  const userName = String(ssoUserName).trim();
  if (!userName) return false;
  return matchAny(userName, data);
}
