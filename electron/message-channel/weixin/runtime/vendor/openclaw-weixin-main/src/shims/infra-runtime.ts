/**
 * Local equivalents of thin-path `openclaw/plugin-sdk/infra-runtime` helpers.
 * Phase 0 — only what vendor logger / pairing need at import time.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const POSIX_OPENCLAW_TMP_DIR = "/tmp/openclaw";

/** Prefer STOCLAW_WEIXIN_TMP_DIR, then OPENCLAW_TMP_DIR, then OS tmp. */
export function resolvePreferredOpenClawTmpDir(): string {
  const fromEnv =
    process.env.STOCLAW_WEIXIN_TMP_DIR?.trim() ||
    process.env.OPENCLAW_TMP_DIR?.trim() ||
    process.env.TMPDIR?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform !== "win32" && fs.existsSync("/tmp")) {
    return POSIX_OPENCLAW_TMP_DIR;
  }
  return path.join(os.tmpdir(), "stoclaw-weixin");
}

/**
 * Minimal file-lock shim: serializes via await of the callback only.
 * Sufficient for Phase 0 thin path (pairing not used by spike).
 */
export async function withFileLock<T>(
  lockPath: string,
  _opts: unknown,
  fn: () => Promise<T> | T,
): Promise<T> {
  void lockPath;
  void _opts;
  return await fn();
}

export { POSIX_OPENCLAW_TMP_DIR };
