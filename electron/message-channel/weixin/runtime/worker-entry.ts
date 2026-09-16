/**
 * Weixin Worker entry — utilityProcess isolated iLink transport.
 * Thin path only: api + monitor + normalize/encode. No OC plugin lifecycle.
 */

import type { WeixinWireCommand, WeixinWireEvent } from '../../../../shared/weixin-runtime-protocol';
import { normalizeInboundMessage } from './adapter/normalize-inbound.js';
import { materializeInboundParts } from './adapter/download-inbound-media.js';
import { encodeAndCommitText, encodeAndSendTyping, encodeAndCancelTyping } from './adapter/encode-outbound.js';
import { encodeAndSendMedia } from './adapter/encode-outbound-media.js';
import {
  DEFAULT_BASE_URL,
  loadAccount,
  loadContextTokens,
  resolvePrimaryAccount,
  saveAccount,
} from './transport/account-store.js';
import { migrateLegacyCredentials } from './transport/migrate-credentials.js';
import { runThinMonitor } from './transport/monitor.js';
import { resolveWeixinStateDir } from './transport/state-dir.js';

const parentPort = (
  process as NodeJS.Process & {
    parentPort?: {
      on(event: 'message', listener: (event: { data: unknown }) => void): void;
      postMessage(value: unknown): void;
    };
  }
).parentPort;

type AccountRuntime = {
  accountId: string;
  token: string;
  baseUrl: string;
};

let account: AccountRuntime | null = null;
let monitorAbort: AbortController | null = null;
let monitorPromise: Promise<void> | null = null;
const contextTokens = new Map<string, string>();
const cancelledPeers = new Set<string>();
const typingTickets = new Map<string, string>();

function post(event: WeixinWireEvent): void {
  parentPort?.postMessage(event);
}

function log(msg: string, extra?: Record<string, unknown>): void {
  console.info(`[weixin-worker] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
}

function rememberContextToken(peerId: string, token?: string): void {
  if (!token?.trim()) return;
  contextTokens.set(peerId, token.trim());
}

function apiOpts(): { baseUrl: string; token: string } {
  if (!account) throw new Error('weixin account not configured');
  return { baseUrl: account.baseUrl, token: account.token };
}

async function stopMonitor(): Promise<void> {
  if (monitorAbort) {
    monitorAbort.abort();
    monitorAbort = null;
  }
  if (monitorPromise) {
    await monitorPromise.catch(() => {});
    monitorPromise = null;
  }
}

async function startMonitor(): Promise<void> {
  if (!account) {
    post({
      type: 'account.status',
      status: 'error',
      message: 'No WeChat account credentials',
      reasonCode: 'AUTH_EXPIRED',
    });
    return;
  }
  await stopMonitor();
  const acct = account;
  monitorAbort = new AbortController();
  const signal = monitorAbort.signal;

  // Warm context tokens from disk
  const diskTokens = loadContextTokens(acct.accountId);
  for (const [peerId, token] of Object.entries(diskTokens)) {
    contextTokens.set(peerId, token);
  }

  post({
    type: 'account.status',
    status: 'connected',
    accountId: acct.accountId,
  });

  log('monitor start', { accountId: acct.accountId, stateDir: resolveWeixinStateDir() });

  monitorPromise = runThinMonitor({
    baseUrl: acct.baseUrl,
    token: acct.token,
    accountId: acct.accountId,
    abortSignal: signal,
    handlers: {
      onPoll: (info) => {
        post({
          type: 'transport.health',
          pollLatencyMs: info.elapsedMs,
          consecutiveFailures: info.ok ? 0 : 1,
        });
      },
      onMessages: async (resp) => {
        for (const msg of resp.msgs ?? []) {
          const inbound = normalizeInboundMessage({
            accountId: acct.accountId,
            msg,
          });
          if (!inbound) continue;
          rememberContextToken(inbound.peerId, inbound.contextToken);
          try {
            const materialized = await materializeInboundParts({
              itemList: msg.item_list as Parameters<typeof materializeInboundParts>[0]['itemList'],
              messageId: inbound.messageId,
            });
            if (materialized.text) inbound.text = materialized.text;
            if (materialized.parts.length) inbound.parts = materialized.parts;
          } catch (err) {
            log('inbound media materialize failed', { error: String(err) });
          }
          // Drop if still empty after materialize
          if (!inbound.text?.trim() && !(inbound.parts?.length)) continue;
          post(inbound);
        }
      },
    },
  }).then((result) => {
    log('monitor stopped', {
      successfulRounds: result.successfulRounds,
      observedMs: result.observedMs,
      lastError: result.lastError ?? null,
    });
    if (!signal.aborted) {
      post({
        type: 'account.status',
        status: 'disconnected',
        accountId: acct.accountId,
        message: result.lastError,
      });
    }
  });
}

function loadAccountRuntime(accountId?: string): AccountRuntime | null {
  if (accountId) {
    const data = loadAccount(accountId);
    if (!data?.token?.trim()) return null;
    return {
      accountId,
      token: data.token.trim(),
      baseUrl: data.baseUrl?.trim() || DEFAULT_BASE_URL,
    };
  }
  const primary = resolvePrimaryAccount();
  if (!primary?.data.token?.trim()) return null;
  return {
    accountId: primary.accountId,
    token: primary.data.token.trim(),
    baseUrl: primary.data.baseUrl?.trim() || DEFAULT_BASE_URL,
  };
}

async function handleCommand(cmd: WeixinWireCommand): Promise<void> {
  switch (cmd.type) {
    case 'runtime.start': {
      if (!account) {
        account = loadAccountRuntime();
      }
      await startMonitor();
      return;
    }
    case 'runtime.stop': {
      await stopMonitor();
      post({ type: 'account.status', status: 'disconnected', accountId: account?.accountId });
      return;
    }
    case 'account.upsert': {
      saveAccount(cmd.accountId, {
        token: cmd.token,
        baseUrl: cmd.baseUrl,
        userId: cmd.userId,
      });
      account = {
        accountId: cmd.accountId,
        token: cmd.token.trim(),
        baseUrl: cmd.baseUrl?.trim() || DEFAULT_BASE_URL,
      };
      log('account upsert', { accountId: cmd.accountId });
      return;
    }
    case 'account.remove': {
      await stopMonitor();
      if (account?.accountId === cmd.accountId) account = null;
      return;
    }
    case 'outbound.typing': {
      if (cancelledPeers.has(cmd.peerId)) {
        // New typing after a cancel starts a fresh turn.
        cancelledPeers.delete(cmd.peerId);
      }
      try {
        const ticket = cmd.typingTicket || typingTickets.get(cmd.peerId);
        const result = await encodeAndSendTyping({
          api: apiOpts(),
          peerId: cmd.peerId,
          typingTicket: ticket,
          contextToken: cmd.contextToken || contextTokens.get(cmd.peerId),
        });
        if (result.typingTicket) typingTickets.set(cmd.peerId, result.typingTicket);
      } catch (err) {
        log('typing failed', { error: String(err) });
      }
      return;
    }
    case 'outbound.commit': {
      if (cancelledPeers.has(cmd.peerId)) {
        cancelledPeers.delete(cmd.peerId);
        post({
          type: 'outbound.result',
          ok: false,
          clientRequestId: cmd.clientRequestId,
          reasonCode: 'UNKNOWN',
          message: 'cancelled',
        });
        return;
      }
      try {
        const contextToken = cmd.contextToken || contextTokens.get(cmd.peerId);
        const result = await encodeAndCommitText({
          api: apiOpts(),
          peerId: cmd.peerId,
          text: cmd.text,
          contextToken,
          clientRequestId: cmd.clientRequestId,
        });
        // Clear typing after successful commit
        const ticket = typingTickets.get(cmd.peerId);
        if (ticket) {
          try {
            await encodeAndCancelTyping({
              api: apiOpts(),
              peerId: cmd.peerId,
              typingTicket: ticket,
            });
          } catch {
            // best-effort
          }
        }
        cancelledPeers.delete(cmd.peerId);
        post({
          type: 'outbound.result',
          ok: true,
          clientRequestId: cmd.clientRequestId,
          messageId: result.messageId,
        });
      } catch (err) {
        post({
          type: 'outbound.result',
          ok: false,
          clientRequestId: cmd.clientRequestId,
          reasonCode: 'PROTOCOL_REJECTED',
          message: String(err),
        });
      }
      return;
    }
    case 'outbound.sendMedia': {
      if (cancelledPeers.has(cmd.peerId)) {
        cancelledPeers.delete(cmd.peerId);
        post({
          type: 'outbound.result',
          ok: false,
          clientRequestId: cmd.clientRequestId,
          reasonCode: 'UNKNOWN',
          message: 'cancelled',
        });
        return;
      }
      try {
        const contextToken = cmd.contextToken || contextTokens.get(cmd.peerId);
        const result = await encodeAndSendMedia({
          api: apiOpts(),
          peerId: cmd.peerId,
          filePath: cmd.filePath,
          caption: cmd.caption,
          contextToken,
          clientRequestId: cmd.clientRequestId,
        });
        const ticket = typingTickets.get(cmd.peerId);
        if (ticket) {
          try {
            await encodeAndCancelTyping({
              api: apiOpts(),
              peerId: cmd.peerId,
              typingTicket: ticket,
            });
          } catch {
            // best-effort
          }
        }
        post({
          type: 'outbound.result',
          ok: true,
          clientRequestId: cmd.clientRequestId,
          messageId: result.messageId,
        });
      } catch (err) {
        post({
          type: 'outbound.result',
          ok: false,
          clientRequestId: cmd.clientRequestId,
          reasonCode: 'MEDIA_FAILED',
          message: String(err),
        });
      }
      return;
    }
    case 'outbound.cancel': {
      // Local cancel only: stop typing pulse on WeChat and suppress a *future* commit.
      // Do not race with an in-flight outbound.commit (host must not cancel after commit).
      if (cmd.peerId) cancelledPeers.add(cmd.peerId);
      else cancelledPeers.clear();
      const peers = cmd.peerId ? [cmd.peerId] : [...typingTickets.keys()];
      for (const peerId of peers) {
        const ticket = typingTickets.get(peerId);
        if (!ticket || !account) continue;
        try {
          await encodeAndCancelTyping({
            api: apiOpts(),
            peerId,
            typingTicket: ticket,
          });
        } catch (err) {
          log('typing cancel failed', { error: String(err) });
        }
      }
      return;
    }
    default:
      return;
  }
}

function boot(): void {
  try {
    migrateLegacyCredentials({ overwrite: false });
    // Prefer existing credentials so runtime.start can connect immediately after ready.
    account = loadAccountRuntime();
    post({ type: 'runtime.ready' });
    log('ready', { hasAccount: Boolean(account), stateDir: resolveWeixinStateDir() });
  } catch (err) {
    post({
      type: 'runtime.failed',
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}

parentPort?.on('message', (event) => {
  const data = (event as { data?: unknown }).data ?? event;
  void handleCommand(data as WeixinWireCommand).catch((err) => {
    log('command failed', { error: String(err) });
  });
});

boot();
