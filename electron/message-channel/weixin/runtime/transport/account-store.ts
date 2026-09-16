/**
 * Thin account credential store for Weixin iLink (Phase 0+).
 * No OpenClaw Gateway / plugin lifecycle.
 */

import fs from "node:fs";
import path from "node:path";

import {
  resolveAccountIndexPath,
  resolveAccountsDir,
  resolveWeixinStateDir,
} from "./state-dir.js";

export type WeixinAccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
};

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

export function listIndexedAccountIds(stateDir = resolveWeixinStateDir()): string[] {
  const filePath = resolveAccountIndexPath(stateDir);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

export function registerAccountId(accountId: string, stateDir = resolveWeixinStateDir()): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const existing = listIndexedAccountIds(stateDir);
  if (existing.includes(accountId)) return;
  fs.writeFileSync(
    resolveAccountIndexPath(stateDir),
    JSON.stringify([...existing, accountId], null, 2),
    "utf-8",
  );
}

function accountPath(accountId: string, stateDir = resolveWeixinStateDir()): string {
  return path.join(resolveAccountsDir(stateDir), `${accountId}.json`);
}

export function loadAccount(
  accountId: string,
  stateDir = resolveWeixinStateDir(),
): WeixinAccountData | null {
  const filePath = accountPath(accountId, stateDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WeixinAccountData;
  } catch {
    return null;
  }
}

export function saveAccount(
  accountId: string,
  update: WeixinAccountData,
  stateDir = resolveWeixinStateDir(),
): void {
  const dir = resolveAccountsDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadAccount(accountId, stateDir) ?? {};
  const data: WeixinAccountData = {
    ...existing,
    ...update,
    ...(update.token ? { savedAt: new Date().toISOString() } : {}),
  };
  const filePath = accountPath(accountId, stateDir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
  registerAccountId(accountId, stateDir);
}

export function getSyncBufPath(accountId: string, stateDir = resolveWeixinStateDir()): string {
  return path.join(resolveAccountsDir(stateDir), `${accountId}.sync.json`);
}

export function loadSyncBuf(accountId: string, stateDir = resolveWeixinStateDir()): string {
  const filePath = getSyncBufPath(accountId, stateDir);
  try {
    if (!fs.existsSync(filePath)) return "";
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { get_updates_buf?: string };
    return typeof parsed.get_updates_buf === "string" ? parsed.get_updates_buf : "";
  } catch {
    return "";
  }
}

export function saveSyncBuf(
  accountId: string,
  getUpdatesBuf: string,
  stateDir = resolveWeixinStateDir(),
): void {
  const dir = resolveAccountsDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    getSyncBufPath(accountId, stateDir),
    JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0),
    "utf-8",
  );
}

export function loadContextTokens(
  accountId: string,
  stateDir = resolveWeixinStateDir(),
): Record<string, string> {
  const filePath = path.join(resolveAccountsDir(stateDir), `${accountId}.context-tokens.json`);
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function resolvePrimaryAccount(
  stateDir = resolveWeixinStateDir(),
): { accountId: string; data: WeixinAccountData } | null {
  const ids = listIndexedAccountIds(stateDir);
  for (const id of ids) {
    const data = loadAccount(id, stateDir);
    if (data?.token?.trim()) return { accountId: id, data };
  }
  // Fallback: scan accounts/*.json
  const dir = resolveAccountsDir(stateDir);
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.includes(".sync.") || name.includes("context-tokens")) {
      continue;
    }
    const accountId = name.replace(/\.json$/, "");
    const data = loadAccount(accountId, stateDir);
    if (data?.token?.trim()) return { accountId, data };
  }
  return null;
}

/** Remove credential / sync / context-token files and drop from index. */
export function clearAccountFiles(
  accountId: string,
  stateDir = resolveWeixinStateDir(),
): void {
  const dir = resolveAccountsDir(stateDir);
  for (const suffix of [".json", ".sync.json", ".context-tokens.json"]) {
    try {
      fs.unlinkSync(path.join(dir, `${accountId}${suffix}`));
    } catch {
      // ignore
    }
  }
  const remaining = listIndexedAccountIds(stateDir).filter((id) => id !== accountId);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(resolveAccountIndexPath(stateDir), JSON.stringify(remaining, null, 2), "utf-8");
}
