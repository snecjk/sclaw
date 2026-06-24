/**
 * 将 package.json version 转为侧栏展示格式（如 v2026.06.23）。
 *
 * 规则：丢弃 `-` 后缀；主版本后各段补零至 2 位。
 */
export function formatAppDisplayVersion(rawVersion: string): string {
  const core = rawVersion.split('-')[0]?.trim() ?? rawVersion;
  const parts = core.split('.').filter(Boolean);

  const pad2 = (segment: string) => segment.padStart(2, '0');

  if (parts.length >= 3) {
    return `v${parts[0]}.${pad2(parts[1])}.${pad2(parts[2])}`;
  }

  if (parts.length === 2) {
    return `v${parts[0]}.${pad2(parts[1])}`;
  }

  if (parts.length === 1) {
    const single = parts[0];
    return single.startsWith('v') ? single : `v${single}`;
  }

  return core.startsWith('v') ? core : `v${core}`;
}
