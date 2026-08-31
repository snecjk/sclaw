export const PI_BUILTIN_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
] as const;

/**
 * Pi treats createAgentSession.tools as a final allowlist for built-in,
 * custom, and extension tools. Keep extension tools in that allowlist while
 * preserving the SClaw-selected built-ins.
 */
export function buildPiEnabledToolNames(extensionToolNames: readonly string[]): string[] {
  const enabled = new Map<string, string>();
  for (const name of [...PI_BUILTIN_TOOL_NAMES, ...extensionToolNames]) {
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
): PiToolSelection {
  return {
    allowedToolNames: buildPiEnabledToolNames(registeredExtensionToolNames),
    initiallyActiveToolNames: buildPiEnabledToolNames(initiallyActiveExtensionToolNames),
  };
}
