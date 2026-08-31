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

/**
 * Pi treats createAgentSession.tools as a final allowlist for built-in,
 * custom, and extension tools. Keep extension tools in that allowlist while
 * preserving the SClaw-selected built-ins.
 */
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
  /** Final SDK allowlist: tools omitted here cannot be activated later. */
  allowedToolNames: string[];
  /** Tools exposed before any lazy activation has matched. */
  initiallyActiveToolNames: string[];
}

/**
 * Pi's SDK uses createAgentSession.tools as both the initial selection and a
 * permanent allowlist. Keep every registered extension tool in that allowlist,
 * then explicitly restore the smaller active set after session creation/reload.
 */
export function buildPiToolSelection(
  registeredExtensionToolNames: readonly string[],
  initiallyActiveExtensionToolNames: readonly string[],
  platform: NodeJS.Platform = process.platform,
): PiToolSelection {
  return {
    allowedToolNames: buildPiEnabledToolNames(registeredExtensionToolNames, platform),
    initiallyActiveToolNames: buildPiEnabledToolNames(initiallyActiveExtensionToolNames, platform),
  };
}
