const PI_BUILTIN_TOOL_NAMES_BEFORE_SHELL = [
  'read',
  'write',
  'edit',
] as const;

const PI_BUILTIN_TOOL_NAMES_AFTER_SHELL = [
  'grep',
  'find',
  'ls',
] as const;

/** Use Pi's native host shell instead of routing Windows commands through WSL. */
export function getPiBuiltinToolNames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    ...PI_BUILTIN_TOOL_NAMES_BEFORE_SHELL,
    platform === 'win32' ? 'powershell' : 'bash',
    ...PI_BUILTIN_TOOL_NAMES_AFTER_SHELL,
  ];
}

export const PI_BUILTIN_TOOL_NAMES = getPiBuiltinToolNames();

/** Build host-native built-ins plus SClaw's initially active static tools. */
export function buildPiEnabledToolNames(
  extensionToolNames: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const enabled = new Map<string, string>();
  for (const name of [...getPiBuiltinToolNames(platform), ...extensionToolNames]) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (!enabled.has(normalized)) enabled.set(normalized, trimmed);
  }
  return [...enabled.values()];
}

export interface PiToolSelection {
  /** Built-ins that must never be exposed on this host. */
  excludedToolNames: string[];
  /** Tools exposed before any lazy activation has matched. */
  initiallyActiveToolNames: string[];
}

/**
 * SClaw does not use Pi's permanent exact-name allowlist because reviewed native
 * extensions may discover tools after session_start. noExtensions keeps loading
 * compile-time controlled, while excludeTools removes the wrong host shell.
 */
export function buildPiToolSelection(
  initiallyActiveExtensionToolNames: readonly string[],
  platform: NodeJS.Platform = process.platform,
): PiToolSelection {
  return {
    excludedToolNames: [platform === 'win32' ? 'bash' : 'powershell'],
    initiallyActiveToolNames: buildPiEnabledToolNames(initiallyActiveExtensionToolNames, platform),
  };
}
