/**
 * Weixin spike — transport smoke + credential copy check.
 *
 * Usage:
 *   npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
 *
 * Env:
 *   STOCLAW_WEIXIN_STATE_DIR   override target state dir (default ~/.stoclaw/weixin)
 *   SPIKE_MIN_ROUNDS          default 5
 *   SPIKE_MIN_OBSERVE_MS      default 600000 (10 min); use 0 for smoke
 *   SPIKE_SEND=1              also attempt one sendMessage (needs context token)
 *   SPIKE_LONG_POLL_MS        default 35000
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrateLegacyCredentials } from "../transport/migrate-credentials.js";
import {
  DEFAULT_BASE_URL,
  loadContextTokens,
  resolvePrimaryAccount,
} from "../transport/account-store.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  getUpdates,
  sendMessage,
} from "../transport/client-v1.js";
import { runThinMonitor } from "../transport/monitor.js";
import { resolveWeixinStateDir } from "../transport/state-dir.js";

type SpikeReport = {
  startedAt: string;
  finishedAt?: string;
  r1: {
    thinTransport: boolean;
    forbiddenImportsOk: boolean;
    getUpdatesSmokeOk: boolean;
    sendMessageOk?: boolean;
    notes: string[];
  };
  r4: {
    migrateOk: boolean;
    copiedFiles: string[];
    successfulRounds: number;
    observedMs: number;
    passed: boolean;
    notes: string[];
  };
  r2: {
    mvpScope: string;
    draftSnapshotTested: false;
    notes: string[];
  };
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const REPORT_DIR = path.join(ROOT, "electron/message-channel/weixin/runtime/spike");

function assertThinImportGraph(): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const transportDir = path.join(ROOT, "electron/message-channel/weixin/runtime/transport");
  const files = fs.readdirSync(transportDir).filter((f) => f.endsWith(".ts"));
  const forbiddenImportRe =
    /from\s+['"][^'"]*(process-message|outbound-hooks|pairing|channel)[^'"]*['"]|require\(['"][^'"]*@tencent-weixin\/openclaw-weixin/;
  const pluginSdkValueImportRe =
    /^\s*import\s+(?!type\b)[^;]*from\s+['"]openclaw\/plugin-sdk\//;
  let ok = true;
  for (const file of files) {
    const text = fs.readFileSync(path.join(transportDir, file), "utf-8");
    if (forbiddenImportRe.test(text)) {
      ok = false;
      notes.push(`transport/${file} has forbidden module import`);
    }
    for (const line of text.split("\n")) {
      if (pluginSdkValueImportRe.test(line)) {
        ok = false;
        notes.push(`transport/${file} has plugin-sdk value import: ${line.trim()}`);
      }
    }
  }
  if (ok) {
    notes.push(
      "transport/* import graph OK (no process-message / hooks / pairing / channel plugin / npm plugin)",
    );
  }
  return { ok, notes };
}

async function main(): Promise<void> {
  const minRounds = Number(process.env.SPIKE_MIN_ROUNDS ?? "5");
  const minObserveMs = Number(process.env.SPIKE_MIN_OBSERVE_MS ?? String(10 * 60_000));
  const longPollMs = Number(process.env.SPIKE_LONG_POLL_MS ?? "35000");
  const doSend = process.env.SPIKE_SEND === "1";

  const report: SpikeReport = {
    startedAt: new Date().toISOString(),
    r1: {
      thinTransport: false,
      forbiddenImportsOk: false,
      getUpdatesSmokeOk: false,
      notes: [],
    },
    r4: {
      migrateOk: false,
      copiedFiles: [],
      successfulRounds: 0,
      observedMs: 0,
      passed: false,
      notes: [],
    },
    r2: {
      mvpScope: "typing + commit (+ cancel); no outbound.sendText draft snapshot",
      draftSnapshotTested: false,
      notes: [
        "Spike does not exercise MessagePort draft snapshots.",
        "Optional GENERATING probe is out of MVP; not run in this spike.",
      ],
    },
  };

  const graph = assertThinImportGraph();
  report.r1.forbiddenImportsOk = graph.ok;
  report.r1.notes.push(...graph.notes);

  const migrate = migrateLegacyCredentials({ overwrite: true });
  report.r4.migrateOk = migrate.hadSource && migrate.copiedFiles.length > 0;
  report.r4.copiedFiles = migrate.copiedFiles;
  report.r4.notes.push(
    migrate.hadSource
      ? `migrated from ${migrate.sourceDir} → ${migrate.targetDir} (${migrate.copiedFiles.length} files)`
      : `no legacy source at ${migrate.sourceDir}`,
  );

  const primary = resolvePrimaryAccount();
  if (!primary?.data.token) {
    report.r1.notes.push("no account token in new state dir; R1/R4 cannot proceed without credentials");
    report.r4.notes.push("fail: missing credentials after migrate — rescanning required");
    await writeReport(report);
    process.exitCode = 1;
    return;
  }

  const baseUrl = primary.data.baseUrl?.trim() || DEFAULT_BASE_URL;
  const token = primary.data.token;
  const accountId = primary.accountId;
  report.r1.notes.push(`using accountId=${accountId} stateDir=${resolveWeixinStateDir()}`);

  // Point vendor resolveStateDir away from unrelated ~/.openclaw if needed (sync buf uses our store).
  process.env.OPENCLAW_STATE_DIR =
    process.env.OPENCLAW_STATE_DIR?.trim() || path.join(resolveWeixinStateDir(), ".vendor-compat");

  // Smoke: one getUpdates
  try {
    const syncBuf = "";
    const smoke = await getUpdates({
      baseUrl,
      token,
      get_updates_buf: syncBuf || (await import("../transport/account-store.js")).loadSyncBuf(accountId),
      timeoutMs: Math.min(longPollMs, 15_000),
    });
    const ok =
      (smoke.ret === undefined || smoke.ret === 0) &&
      (smoke.errcode === undefined || smoke.errcode === 0);
    report.r1.getUpdatesSmokeOk = ok;
    report.r1.notes.push(
      ok
        ? `smoke getUpdates ok msgs=${smoke.msgs?.length ?? 0}`
        : `smoke getUpdates failed ret=${smoke.ret} errcode=${smoke.errcode}`,
    );
  } catch (err) {
    report.r1.getUpdatesSmokeOk = false;
    report.r1.notes.push(`smoke getUpdates threw: ${String(err)}`);
  }

  if (doSend && report.r1.getUpdatesSmokeOk) {
    const tokens = loadContextTokens(accountId);
    const peerId = Object.keys(tokens)[0];
    const contextToken = peerId ? tokens[peerId] : undefined;
    if (peerId && contextToken) {
      try {
        const resp = await sendMessage({
          baseUrl,
          token,
          body: {
            msg: {
              from_user_id: "",
              to_user_id: peerId,
              client_id: `phase0-spike:${Date.now()}`,
              message_type: MessageType.BOT,
              message_state: MessageState.FINISH,
              item_list: [
                {
                  type: MessageItemType.TEXT,
                  text_item: { text: "[SClaw Phase0] thin-transport spike ping" },
                },
              ],
              context_token: contextToken,
            },
          },
        });
        report.r1.sendMessageOk = true;
        report.r1.notes.push(`sendMessage ok message_id=${resp.message_id ?? "(none)"}`);
      } catch (err) {
        report.r1.sendMessageOk = false;
        report.r1.notes.push(`sendMessage failed: ${String(err)}`);
      }
    } else {
      report.r1.sendMessageOk = false;
      report.r1.notes.push("SPIKE_SEND=1 but no context token peer found; skipped send");
    }
  }

  report.r1.thinTransport =
    report.r1.forbiddenImportsOk && report.r1.getUpdatesSmokeOk;

  // R4 observation window
  if (report.r1.getUpdatesSmokeOk) {
    console.log(
      `[spike] R4 monitor start: minRounds=${minRounds} minObserveMs=${minObserveMs} account=${accountId}`,
    );
    const result = await runThinMonitor({
      baseUrl,
      token,
      accountId,
      maxSuccessfulRounds: minRounds,
      minObserveMs,
      longPollTimeoutMs: longPollMs,
      handlers: {
        onPoll: (info) => {
          console.log(
            `[spike] round=${info.round} ok=${info.ok} msgs=${info.msgCount} elapsedMs=${info.elapsedMs}` +
              (info.ret !== undefined ? ` ret=${info.ret}` : ""),
          );
        },
      },
    });
    report.r4.successfulRounds = result.successfulRounds;
    report.r4.observedMs = result.observedMs;
    report.r4.passed =
      report.r4.migrateOk &&
      result.successfulRounds >= minRounds &&
      result.observedMs >= minObserveMs;
    if (result.lastError) report.r4.notes.push(`lastError=${result.lastError}`);
    report.r4.notes.push(
      `successfulRounds=${result.successfulRounds} observedMs=${result.observedMs} passed=${report.r4.passed}`,
    );
  } else {
    report.r4.notes.push("skipped R4 monitor because smoke getUpdates failed");
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(report);

  const passed = report.r1.thinTransport && report.r4.passed;
  console.log(`[spike] done passed=${passed}`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = passed ? 0 : 1;
}

async function writeReport(report: SpikeReport): Promise<void> {
  report.finishedAt = report.finishedAt ?? new Date().toISOString();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, "phase0-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf-8");
  console.log(`[spike] wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
