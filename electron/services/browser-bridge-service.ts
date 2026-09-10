import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import type {
  BrowserBridgeCommand,
  BrowserBridgeCommandResult,
  BrowserBridgeControlCommand,
  BrowserBridgeChromeConsent,
  BrowserBridgeSession,
} from '../../shared/browser-bridge/types';
import {
  BROWSER_BRIDGE_COMMAND_TTL_MS,
  BROWSER_BRIDGE_EMBED_TAB_ID,
  BROWSER_BRIDGE_EMBED_TOKEN,
  BROWSER_BRIDGE_POLL_WAIT_MAX_MS,
  BROWSER_BRIDGE_SESSION_STALE_MS,
} from '../../shared/browser-bridge/types';
import { checkBrowserBridgeExtensionCompatibility } from '../../shared/browser-bridge/version';
import { getOpenClawConfigDir } from '../utils/paths';
import { getBundledBrowserBridgeExtensionVersion } from '../utils/browser-bridge-extension';
import { parseChromeTabIdFromBridgeSessionId } from '../../shared/browser-bridge/session-id';

const TOKEN_GRACE_DEFAULT_MS = 60_000;
const COMMAND_RESULTS_MAX = 1000;

interface TokenRecord {
  createdAt: number;
  extensionVersion?: string;
  expiresAt?: number;
}

interface PersistedState {
  pairingCode: string | null;
  tokens: Array<string | { token: string; createdAt: number; extensionVersion?: string }>;
  autoConnectEnabled?: boolean;
  installedExtensionVersion?: string | null;
}

function stateFilePath(): string {
  return join(getOpenClawConfigDir(), 'browser-bridge-state.json');
}

export class BrowserBridgeService {
  private readonly sessions = new Map<string, BrowserBridgeSession>();
  private readonly commandQueues = new Map<string, BrowserBridgeCommand[]>();
  private readonly commandResults = new Map<string, BrowserBridgeCommandResult>();
  private readonly pollWaiters = new Map<string, Array<(commands: BrowserBridgeCommand[] | null) => void>>();
  private pairingCode: string | null = null;
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly graceTokens = new Map<string, TokenRecord>();
  private autoConnectEnabled = true;
  private installedExtensionVersion: string | null = null;
  private chromeConsent: BrowserBridgeChromeConsent = 'unknown';
  private consentPromptOpen = false;
  private readonly consentWaiters: Array<(decision: 'allowed' | 'denied') => void> = [];
  private controlQueue: BrowserBridgeControlCommand[] = [];
  private readonly controlWaiters: Array<(commands: BrowserBridgeControlCommand[]) => void> = [];

  constructor() {
    this.loadPersistedState();
    setInterval(() => this.pruneStale(), 30_000).unref();
  }

  getPairingCode(): { code: string } | null {
    if (!this.pairingCode) return null;
    return { code: this.pairingCode };
  }

  /** Create or replace pairing code. Persists until paired or manually refreshed. */
  refreshPairingCode(): { code: string } {
    this.pairingCode = String(randomInt(100_000, 1_000_000));
    this.persistState();
    return { code: this.pairingCode };
  }

  pairWithCode(code: string): { token: string } | null {
    if (!this.pairingCode || this.pairingCode !== code.trim()) {
      return null;
    }
    const token = randomBytes(24).toString('hex');
    this.tokens.set(token, { createdAt: Date.now() });
    this.pairingCode = null;
    this.persistState();
    return { token };
  }

  validateToken(token: string | undefined | null): boolean {
    if (!token) return false;
    if (this.tokens.has(token)) return true;
    const grace = this.graceTokens.get(token);
    return Boolean(grace && (grace.expiresAt ?? 0) > Date.now());
  }

  getSettings(): { autoConnectEnabled: boolean; installedExtensionVersion: string | null } {
    return {
      autoConnectEnabled: this.autoConnectEnabled,
      installedExtensionVersion: this.installedExtensionVersion,
    };
  }

  setAutoConnectEnabled(enabled: boolean): void {
    this.autoConnectEnabled = enabled;
    if (!enabled) {
      this.tokens.clear();
      this.graceTokens.clear();
    }
    this.persistState();
  }

  checkExtensionCompatibility(extensionVersion: string | undefined | null) {
    return checkBrowserBridgeExtensionCompatibility(
      extensionVersion,
      getBundledBrowserBridgeExtensionVersion(),
    );
  }

  autoConnect(extensionVersion?: string): { token: string } | null {
    if (!this.autoConnectEnabled) return null;
    const compatibility = this.checkExtensionCompatibility(extensionVersion);
    if (!compatibility.compatible) return null;
    if (typeof extensionVersion === 'string' && extensionVersion.trim()) {
      this.installedExtensionVersion = extensionVersion.trim();
    }
    const token = randomBytes(24).toString('hex');
    this.tokens.set(token, { createdAt: Date.now(), extensionVersion: extensionVersion?.trim() });
    this.persistState();
    return { token };
  }

  rotateTokens(opts?: { keepGraceMs?: number }): void {
    const graceMs = opts?.keepGraceMs ?? TOKEN_GRACE_DEFAULT_MS;
    const expiresAt = Date.now() + graceMs;
    for (const [token, record] of this.tokens.entries()) {
      this.graceTokens.set(token, { ...record, expiresAt });
    }
    this.tokens.clear();
    this.persistState();
  }

  revokeAllTokens(): void {
    this.tokens.clear();
    this.graceTokens.clear();
    this.persistState();
  }

  connectSession(input: {
    sessionId: string;
    tabId: number;
    url: string;
    title: string;
    token: string;
    source?: BrowserBridgeSession['source'];
    embedRuntimeId?: string;
    ownership?: BrowserBridgeSession['ownership'];
    extensionVersion?: string;
    groupId?: string;
    taskLabel?: string;
  }): BrowserBridgeSession {
    const source = input.source ?? 'extension';
    if (source === 'extension') {
      for (const [id, existing] of this.sessions.entries()) {
        if (existing.tabId === input.tabId && existing.source !== 'embed' && id !== input.sessionId) {
          this.disconnectSession(id);
        }
      }
    }
    const session: BrowserBridgeSession = {
      sessionId: input.sessionId,
      tabId: input.tabId,
      url: input.url,
      title: input.title || '',
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      token: input.token,
      source,
      embedRuntimeId: input.embedRuntimeId,
      ownership: input.ownership ?? (source === 'embed' ? 'owned' : 'borrowed'),
      extensionVersion: input.extensionVersion,
      groupId: input.groupId,
      taskLabel: input.taskLabel,
    };
    this.sessions.set(input.sessionId, session);
    if (!this.commandQueues.has(input.sessionId)) {
      this.commandQueues.set(input.sessionId, []);
    }
    return session;
  }

  connectEmbedSession(input: {
    sessionId: string;
    embedRuntimeId: string;
    tabId?: number;
    url: string;
    title: string;
  }): BrowserBridgeSession {
    return this.connectSession({
      sessionId: input.sessionId,
      tabId: input.tabId ?? BROWSER_BRIDGE_EMBED_TAB_ID,
      url: input.url,
      title: input.title,
      token: BROWSER_BRIDGE_EMBED_TOKEN,
      source: 'embed',
      embedRuntimeId: input.embedRuntimeId,
      ownership: 'owned',
    });
  }

  disconnectSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.commandQueues.delete(sessionId);
    this.flushPollWaiters(sessionId, null);
  }

  heartbeat(
    sessionId: string,
    patch?: { url?: string; title?: string },
    token?: string,
  ): BrowserBridgeSession | null {
    let session: BrowserBridgeSession | null = this.sessions.get(sessionId) ?? null;
    if (!session && !sessionId.startsWith('embed-')) {
      const tabId = parseChromeTabIdFromBridgeSessionId(sessionId);
      if (tabId != null) {
        this.connectSession({
          sessionId,
          tabId,
          url: patch?.url ?? '',
          title: patch?.title ?? '',
          token: token ?? '',
          source: 'extension',
          ownership: 'borrowed',
        });
        session = this.sessions.get(sessionId) ?? null;
      }
    }
    if (!session) return null;
    session.lastHeartbeat = Date.now();
    if (patch?.url) session.url = patch.url;
    if (patch?.title !== undefined) session.title = patch.title;
    return session;
  }

  findReplacementSession(staleSessionId: string): BrowserBridgeSession | null {
    const tabId = parseChromeTabIdFromBridgeSessionId(staleSessionId);
    const active = this.listActiveSessions();
    if (tabId != null) {
      const sameTab = active.find((session) => session.source !== 'embed' && session.tabId === tabId);
      if (sameTab) return sameTab;
    }
    return active.find((session) => session.source !== 'embed') ?? null;
  }

  listActiveSessions(): BrowserBridgeSession[] {
    const now = Date.now();
    const active = Array.from(this.sessions.values()).filter(
      (session) => now - session.lastHeartbeat < BROWSER_BRIDGE_SESSION_STALE_MS,
    );
    return active.sort((left, right) => {
      const leftExt = left.source === 'embed' ? 1 : 0;
      const rightExt = right.source === 'embed' ? 1 : 0;
      if (leftExt !== rightExt) return leftExt - rightExt;
      return right.lastHeartbeat - left.lastHeartbeat;
    });
  }

  listSessionsByGroup(groupId: string): BrowserBridgeSession[] {
    return this.listActiveSessions().filter((session) => session.groupId === groupId);
  }

  getSession(sessionId: string): BrowserBridgeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getPrimarySession(): BrowserBridgeSession | null {
    const sessions = this.listActiveSessions();
    return sessions.find((session) => session.source === 'embed') ?? sessions[0] ?? null;
  }

  getExtensionSession(): BrowserBridgeSession | null {
    return this.listActiveSessions().find((session) => session.source !== 'embed') ?? null;
  }

  getChromeConsent(): BrowserBridgeChromeConsent {
    return this.chromeConsent;
  }

  /**
   * 首次需要 Chrome 时：unknown → 调用方弹确认；已有决定则立即返回。
   * 并发 ensure-session 共用同一次确认，不会叠两个弹窗。
   */
  beginChromeConsent(): 'allowed' | 'denied' | 'need-ui' | 'pending' {
    if (this.chromeConsent === 'allowed' || this.chromeConsent === 'denied') {
      return this.chromeConsent;
    }
    if (this.consentPromptOpen || this.consentWaiters.length > 0) return 'pending';
    this.consentPromptOpen = true;
    return 'need-ui';
  }

  waitForChromeConsent(timeoutMs: number): Promise<'allowed' | 'denied' | 'timeout'> {
    if (this.chromeConsent === 'allowed' || this.chromeConsent === 'denied') {
      return Promise.resolve(this.chromeConsent);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: 'allowed' | 'denied' | 'timeout') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = this.consentWaiters.indexOf(waiter);
        if (index >= 0) this.consentWaiters.splice(index, 1);
        if (value === 'timeout' && this.chromeConsent === 'unknown' && this.consentWaiters.length === 0) {
          this.consentPromptOpen = false;
        }
        resolve(value);
      };
      const waiter = (decision: 'allowed' | 'denied') => finish(decision);
      const timer = setTimeout(() => finish('timeout'), Math.max(0, timeoutMs));
      this.consentWaiters.push(waiter);
    });
  }

  resolveChromeConsent(allowed: boolean): void {
    this.chromeConsent = allowed ? 'allowed' : 'denied';
    this.consentPromptOpen = false;
    const waiters = this.consentWaiters.splice(0, this.consentWaiters.length);
    for (const waiter of waiters) waiter(this.chromeConsent);
  }

  enqueueControlAttach(url?: string): BrowserBridgeControlCommand {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    const command: BrowserBridgeControlCommand = {
      commandId: randomBytes(12).toString('hex'),
      action: 'attach',
      url: trimmed || undefined,
      createdAt: Date.now(),
      expiresAt: Date.now() + BROWSER_BRIDGE_COMMAND_TTL_MS,
    };
    this.controlQueue.push(command);
    const waiter = this.controlWaiters.shift();
    if (waiter) waiter(this.drainControlQueue());
    return command;
  }

  pollControl(): BrowserBridgeControlCommand[] {
    return this.drainControlQueue();
  }

  waitForControl(waitMs: number): Promise<BrowserBridgeControlCommand[]> {
    const cap = Math.max(0, Math.min(waitMs, BROWSER_BRIDGE_POLL_WAIT_MAX_MS));
    const already = this.drainControlQueue();
    if (already.length > 0 || cap <= 0) return Promise.resolve(already);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: BrowserBridgeControlCommand[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = this.controlWaiters.indexOf(waiter);
        if (index >= 0) this.controlWaiters.splice(index, 1);
        resolve(value);
      };
      const waiter = (commands: BrowserBridgeControlCommand[]) => finish(commands);
      const timer = setTimeout(() => finish(this.drainControlQueue()), cap);
      this.controlWaiters.push(waiter);
    });
  }

  waitForExtensionSession(timeoutMs: number): Promise<BrowserBridgeSession | null> {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const session = this.getExtensionSession();
        if (session) {
          resolve(session);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  private drainControlQueue(): BrowserBridgeControlCommand[] {
    const now = Date.now();
    this.controlQueue = this.controlQueue.filter((command) => command.expiresAt > now);
    const pending = this.controlQueue;
    this.controlQueue = [];
    return pending;
  }

  enqueueCommand(
    sessionId: string,
    action: BrowserBridgeCommand['action'],
    payload: Record<string, unknown> = {},
  ): BrowserBridgeCommand | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const command: BrowserBridgeCommand = {
      commandId: randomBytes(12).toString('hex'),
      action,
      payload,
      createdAt: Date.now(),
      expiresAt: Date.now() + BROWSER_BRIDGE_COMMAND_TTL_MS,
    };
    const queue = this.commandQueues.get(sessionId) ?? [];
    queue.push(command);
    this.commandQueues.set(sessionId, queue);
    const waiter = this.pollWaiters.get(sessionId)?.shift();
    if (waiter) {
      waiter(this.drainPending(sessionId) ?? []);
    }
    return command;
  }

  /**
   * Drain pending commands. `null` means the session is gone (caller should 404
   * so the extension re-connects instead of spinning on an empty poll).
   */
  pollCommands(sessionId: string): BrowserBridgeCommand[] | null {
    return this.drainPending(sessionId);
  }

  /**
   * Long-poll: return immediately if commands are queued, otherwise wait up to
   * waitMs for enqueueCommand. Keeps the Chrome MV3 service worker alive via fetch.
   */
  waitForCommands(sessionId: string, waitMs: number): Promise<BrowserBridgeCommand[] | null> {
    if (!this.sessions.has(sessionId)) return Promise.resolve(null);
    const cap = Math.max(0, Math.min(waitMs, BROWSER_BRIDGE_POLL_WAIT_MAX_MS));
    if (cap <= 0) return Promise.resolve(this.drainPending(sessionId));

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: BrowserBridgeCommand[] | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.removePollWaiter(sessionId, waiter);
        resolve(value);
      };
      const waiter = (commands: BrowserBridgeCommand[] | null) => finish(commands);
      const timer = setTimeout(() => {
        finish(this.drainPending(sessionId) ?? []);
      }, cap);
      const list = this.pollWaiters.get(sessionId) ?? [];
      list.push(waiter);
      this.pollWaiters.set(sessionId, list);
      const already = this.drainPending(sessionId);
      if (already === null) {
        finish(null);
        return;
      }
      if (already.length > 0) finish(already);
    });
  }

  storeResult(input: {
    sessionId: string;
    commandId: string;
    action: BrowserBridgeCommand['action'];
    result: unknown;
  }): BrowserBridgeCommandResult {
    const record: BrowserBridgeCommandResult = {
      commandId: input.commandId,
      sessionId: input.sessionId,
      action: input.action,
      result: input.result,
      completedAt: Date.now(),
    };
    this.commandResults.set(input.commandId, record);
    this.pruneCommandResults();
    return record;
  }

  getResult(commandId: string): BrowserBridgeCommandResult | null {
    return this.commandResults.get(commandId) ?? null;
  }

  waitForResult(commandId: string, timeoutMs: number): Promise<BrowserBridgeCommandResult | null> {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const result = this.getResult(commandId);
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  private pruneCommandResults(): void {
    if (this.commandResults.size <= COMMAND_RESULTS_MAX) return;
    const ordered = Array.from(this.commandResults.entries()).sort(
      (left, right) => left[1].completedAt - right[1].completedAt,
    );
    const overflow = this.commandResults.size - COMMAND_RESULTS_MAX;
    for (let index = 0; index < overflow; index += 1) {
      this.commandResults.delete(ordered[index][0]);
    }
  }

  private loadPersistedState(): void {
    const filePath = stateFilePath();
    if (!existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      this.pairingCode = typeof parsed.pairingCode === 'string' ? parsed.pairingCode : null;
      if (Array.isArray(parsed.tokens)) {
        for (const token of parsed.tokens) {
          if (typeof token === 'string' && token) {
            this.tokens.set(token, { createdAt: Date.now() });
          } else if (token && typeof token === 'object' && typeof token.token === 'string') {
            this.tokens.set(token.token, {
              createdAt: token.createdAt,
              extensionVersion: token.extensionVersion,
            });
          }
        }
      }
      this.autoConnectEnabled = parsed.autoConnectEnabled !== false;
      this.installedExtensionVersion = typeof parsed.installedExtensionVersion === 'string'
        ? parsed.installedExtensionVersion
        : null;
    } catch {
      // Ignore corrupt state file; user can refresh pairing code.
    }
  }

  private persistState(): void {
    const dir = getOpenClawConfigDir();
    mkdirSync(dir, { recursive: true });
    const payload: PersistedState = {
      pairingCode: this.pairingCode,
      tokens: Array.from(this.tokens.entries()).map(([token, record]) => ({
        token,
        createdAt: record.createdAt,
        extensionVersion: record.extensionVersion,
      })),
      autoConnectEnabled: this.autoConnectEnabled,
      installedExtensionVersion: this.installedExtensionVersion,
    };
    writeFileSync(stateFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  private drainPending(sessionId: string): BrowserBridgeCommand[] | null {
    if (!this.sessions.has(sessionId)) return null;
    const queue = this.commandQueues.get(sessionId) ?? [];
    const now = Date.now();
    const pending = queue.filter((cmd) => cmd.expiresAt > now);
    this.commandQueues.set(sessionId, []);
    return pending;
  }

  private removePollWaiter(
    sessionId: string,
    waiter: (commands: BrowserBridgeCommand[] | null) => void,
  ): void {
    const list = this.pollWaiters.get(sessionId);
    if (!list) return;
    this.pollWaiters.set(sessionId, list.filter((item) => item !== waiter));
  }

  private flushPollWaiters(sessionId: string, value: BrowserBridgeCommand[] | null): void {
    const list = this.pollWaiters.get(sessionId) ?? [];
    this.pollWaiters.delete(sessionId);
    for (const waiter of list) waiter(value);
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastHeartbeat > BROWSER_BRIDGE_SESSION_STALE_MS) {
        this.sessions.delete(sessionId);
        this.commandQueues.delete(sessionId);
        this.flushPollWaiters(sessionId, null);
      }
    }
    for (const [commandId, result] of this.commandResults.entries()) {
      if (now - result.completedAt > 5 * 60 * 1000) {
        this.commandResults.delete(commandId);
      }
    }
    this.pruneCommandResults();
    for (const [token, record] of this.graceTokens.entries()) {
      if ((record.expiresAt ?? 0) <= now) this.graceTokens.delete(token);
    }
  }
}

export const browserBridgeService = new BrowserBridgeService();
