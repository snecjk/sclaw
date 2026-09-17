/**
 * Thin long-poll monitor — getUpdates only; no process-message / OC channelRuntime.
 */

import {
  getUpdates,
  type GetUpdatesResp,
  type WeixinApiOptions,
} from "./client-v1.js";
import { loadSyncBuf, saveSyncBuf } from "./account-store.js";

export type ThinMonitorHandlers = {
  onPoll?: (info: {
    round: number;
    ok: boolean;
    msgCount: number;
    ret?: number;
    errcode?: number;
    elapsedMs: number;
  }) => void;
  onMessages?: (resp: GetUpdatesResp) => void | Promise<void>;
};

export type ThinMonitorOptions = WeixinApiOptions & {
  accountId: string;
  /** Max successful polls before exit (undefined = until abort). */
  maxSuccessfulRounds?: number;
  /** Wall-clock minimum observation window before exit (ms). */
  minObserveMs?: number;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  handlers?: ThinMonitorHandlers;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

/**
 * Poll getUpdates until success-count / observe-window / abort criteria met.
 * Persists sync buf via transport account-store (new state dir).
 */
export async function runThinMonitor(opts: ThinMonitorOptions): Promise<{
  successfulRounds: number;
  observedMs: number;
  lastError?: string;
}> {
  const started = Date.now();
  let successfulRounds = 0;
  let consecutiveFailures = 0;
  let lastError: string | undefined;
  let getUpdatesBuf = loadSyncBuf(opts.accountId);
  let nextTimeoutMs = opts.longPollTimeoutMs ?? 35_000;
  let round = 0;

  while (!opts.abortSignal?.aborted) {
    const observedMs = Date.now() - started;
    if (
      opts.maxSuccessfulRounds !== undefined &&
      successfulRounds >= opts.maxSuccessfulRounds &&
      (opts.minObserveMs === undefined || observedMs >= opts.minObserveMs)
    ) {
      break;
    }
    if (
      opts.maxSuccessfulRounds !== undefined &&
      successfulRounds >= opts.maxSuccessfulRounds &&
      opts.minObserveMs !== undefined &&
      observedMs < opts.minObserveMs
    ) {
      // Keep observing until min window; use short sleep between extra polls.
    }

    round += 1;
    const tick = Date.now();
    try {
      const resp = await getUpdates({
        baseUrl: opts.baseUrl,
        token: opts.token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
        abortSignal: opts.abortSignal,
      });

      const elapsedMs = Date.now() - tick;
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        consecutiveFailures += 1;
        lastError = `ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`;
        opts.handlers?.onPoll?.({
          round,
          ok: false,
          msgCount: 0,
          ret: resp.ret,
          errcode: resp.errcode,
          elapsedMs,
        });
        await sleep(consecutiveFailures >= 3 ? 30_000 : 2_000, opts.abortSignal);
        continue;
      }

      consecutiveFailures = 0;
      successfulRounds += 1;
      if (typeof resp.get_updates_buf === "string") {
        getUpdatesBuf = resp.get_updates_buf;
        saveSyncBuf(opts.accountId, getUpdatesBuf);
      }
      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      opts.handlers?.onPoll?.({
        round,
        ok: true,
        msgCount: resp.msgs?.length ?? 0,
        ret: resp.ret,
        elapsedMs,
      });
      if (resp.msgs?.length) {
        await opts.handlers?.onMessages?.(resp);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") break;
      consecutiveFailures += 1;
      lastError = String(err);
      opts.handlers?.onPoll?.({
        round,
        ok: false,
        msgCount: 0,
        elapsedMs: Date.now() - tick,
      });
      await sleep(consecutiveFailures >= 3 ? 30_000 : 2_000, opts.abortSignal);
    }
  }

  return { successfulRounds, observedMs: Date.now() - started, lastError };
}
