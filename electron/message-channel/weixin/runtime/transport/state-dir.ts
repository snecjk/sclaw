/**
 * Weixin Worker transport state directory (independent of OpenClaw).
 *
 * Default: ~/.stoclaw/weixin
 * Override: STOCLAW_WEIXIN_STATE_DIR
 */

import os from "node:os";
import path from "node:path";

export function resolveWeixinStateDir(): string {
  const fromEnv = process.env.STOCLAW_WEIXIN_STATE_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".stoclaw", "weixin");
}

/** Legacy OpenClaw-hosted weixin state (StoClaw install). */
export function resolveLegacyOpenClawWeixinStateDir(): string {
  return path.join(os.homedir(), ".stoclaw", "openclaw", "openclaw-weixin");
}

export function resolveAccountsDir(stateDir = resolveWeixinStateDir()): string {
  return path.join(stateDir, "accounts");
}

export function resolveAccountIndexPath(stateDir = resolveWeixinStateDir()): string {
  return path.join(stateDir, "accounts.json");
}
