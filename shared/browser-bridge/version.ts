/** 扩展端 ↔ 服务端版本配对（计划 §四 B12 / P2-5）。 */

export interface BrowserBridgeVersionCheck {
  compatible: boolean;
  updateAvailable: boolean;
  reason?: string;
}

function parseSemver(raw: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  };
}

/**
 * major 不同 → 不兼容（connect 拒绝 BRIDGE_VERSION_MISMATCH）；
 * minor/patch 不同 → 兼容但 updateAvailable。
 */
export function checkBrowserBridgeExtensionCompatibility(
  installedVersion: string | undefined | null,
  bundledVersion: string,
): BrowserBridgeVersionCheck {
  const bundled = parseSemver(bundledVersion);
  if (!bundled) {
    return { compatible: true, updateAvailable: false, reason: 'bundled version unreadable' };
  }
  if (!installedVersion?.trim()) {
    return {
      compatible: true,
      updateAvailable: true,
      reason: 'extension version not reported',
    };
  }
  const installed = parseSemver(installedVersion);
  if (!installed) {
    return {
      compatible: false,
      updateAvailable: true,
      reason: `invalid extension version: ${installedVersion}`,
    };
  }
  if (installed.major !== bundled.major) {
    return {
      compatible: false,
      updateAvailable: true,
      reason: `major mismatch: extension ${installedVersion} vs bundled ${bundledVersion}`,
    };
  }
  const updateAvailable = installed.minor !== bundled.minor || installed.patch !== bundled.patch;
  return {
    compatible: true,
    updateAvailable,
    reason: updateAvailable ? `minor/patch differs: extension ${installedVersion} vs bundled ${bundledVersion}` : undefined,
  };
}
