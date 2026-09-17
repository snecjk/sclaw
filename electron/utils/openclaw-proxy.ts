import type { ProxySettings } from './proxy';

interface SyncProxyOptions {
  /** Retained for call-site compatibility; ignored (proxy sync is a no-op). */
  preserveExistingWhenDisabled?: boolean;
}

/**
 * Formerly synced StoClaw proxy into OpenClaw per-channel proxy knobs.
 * Retired IM OC channels no longer receive proxy writes — kept as a no-op export.
 */
export async function syncProxyConfigToOpenClaw(
  settings: ProxySettings,
  options: SyncProxyOptions = {},
): Promise<void> {
  void settings;
  void options;
}
