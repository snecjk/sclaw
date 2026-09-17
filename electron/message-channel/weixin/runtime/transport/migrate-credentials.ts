/**
 * Legacy OpenClaw → Host weixin credential migration.
 *
 * Permanent no-op since CHANNEL_BIND_EPOCH `2026.09-host-weixin`:
 * epoch reset deletes both dirs; post-epoch re-scan writes only `~/.stoclaw/weixin/`.
 * Do not copy from `~/.stoclaw/openclaw/openclaw-weixin/` anymore.
 *
 * All production call sites (binding, service.start, worker-entry boot) must stay no-op.
 * Spike scripts may still call this; they also get an empty result.
 */

import {
  resolveLegacyOpenClawWeixinStateDir,
  resolveWeixinStateDir,
} from "./state-dir.js";

export type MigrateCredentialsResult = {
  sourceDir: string;
  targetDir: string;
  copiedFiles: string[];
  skipped: string[];
  hadSource: boolean;
};

/**
 * @deprecated Permanent no-op — credentials are never copied from legacy dirs.
 */
export function migrateLegacyCredentials(options?: {
  sourceDir?: string;
  targetDir?: string;
  overwrite?: boolean;
}): MigrateCredentialsResult {
  const sourceDir = options?.sourceDir ?? resolveLegacyOpenClawWeixinStateDir();
  const targetDir = options?.targetDir ?? resolveWeixinStateDir();
  return {
    sourceDir,
    targetDir,
    copiedFiles: [],
    skipped: [],
    hadSource: false,
  };
}
