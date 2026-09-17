/**
 * Copy older weixin credentials into the StoClaw weixin state dir when present.
 * Does not delete the source.
 */

import fs from "node:fs";
import path from "node:path";

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

function copyFileIfPresent(src: string, dest: string, copied: string[], skipped: string[]): void {
  if (!fs.existsSync(src)) {
    skipped.push(src);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  try {
    if (dest.endsWith(".json") && !dest.includes("accounts.json") && !dest.includes("sync") && !dest.includes("context")) {
      fs.chmodSync(dest, 0o600);
    }
  } catch {
    // best-effort
  }
  copied.push(path.relative(path.dirname(path.dirname(dest)), dest) || dest);
}

/**
 * Migrate `~/.stoclaw/openclaw/openclaw-weixin/**` → `~/.stoclaw/weixin/**`.
 */
export function migrateLegacyCredentials(options?: {
  sourceDir?: string;
  targetDir?: string;
  overwrite?: boolean;
}): MigrateCredentialsResult {
  const sourceDir = options?.sourceDir ?? resolveLegacyOpenClawWeixinStateDir();
  const targetDir = options?.targetDir ?? resolveWeixinStateDir();
  const overwrite = options?.overwrite ?? true;
  const copiedFiles: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(sourceDir)) {
    return { sourceDir, targetDir, copiedFiles, skipped, hadSource: false };
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const indexSrc = path.join(sourceDir, "accounts.json");
  const indexDest = path.join(targetDir, "accounts.json");
  if (fs.existsSync(indexSrc) && (overwrite || !fs.existsSync(indexDest))) {
    copyFileIfPresent(indexSrc, indexDest, copiedFiles, skipped);
  }

  const accountsSrc = path.join(sourceDir, "accounts");
  const accountsDest = path.join(targetDir, "accounts");
  if (fs.existsSync(accountsSrc)) {
    fs.mkdirSync(accountsDest, { recursive: true });
    for (const name of fs.readdirSync(accountsSrc)) {
      const src = path.join(accountsSrc, name);
      const dest = path.join(accountsDest, name);
      if (!fs.statSync(src).isFile()) continue;
      if (!overwrite && fs.existsSync(dest)) {
        skipped.push(src);
        continue;
      }
      copyFileIfPresent(src, dest, copiedFiles, skipped);
    }
  }

  return { sourceDir, targetDir, copiedFiles, skipped, hadSource: true };
}
