/**
 * 将 package.json version 转为侧栏展示格式（如 v2026.06.23、v2026.07.09-1）。
 *
 * 规则：保留 `-` 后缀原样；仅主版本（`-` 前）各段补零至 2 位。
 */
export function formatAppDisplayVersion(rawVersion: string): string {
  const trimmed = rawVersion.trim();
  const dashIndex = trimmed.indexOf('-');
  const core = dashIndex >= 0 ? trimmed.slice(0, dashIndex) : trimmed;
  const suffix = dashIndex >= 0 ? trimmed.slice(dashIndex) : '';

  const parts = core.split('.').filter(Boolean);
  const pad2 = (segment: string) => segment.padStart(2, '0');

  let formatted: string;
  if (parts.length >= 3) {
    formatted = `v${parts[0]}.${pad2(parts[1])}.${pad2(parts[2])}`;
  } else if (parts.length === 2) {
    formatted = `v${parts[0]}.${pad2(parts[1])}`;
  } else if (parts.length === 1) {
    const single = parts[0];
    formatted = single.startsWith('v') ? single : `v${single}`;
  } else {
    formatted = core.startsWith('v') ? core : `v${core}`;
  }

  return `${formatted}${suffix}`;
}
