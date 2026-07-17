import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import type {
  BrowserBridgeCommand,
  BrowserBridgeCommandResult,
  BrowserBridgeSession,
} from '../../shared/browser-bridge/types';
import {
  BROWSER_BRIDGE_COMMAND_TTL_MS,
  BROWSER_BRIDGE_EMBED_TAB_ID,
  BROWSER_BRIDGE_EMBED_TOKEN,
  BROWSER_BRIDGE_SESSION_STALE_MS,
} from '../../shared/browser-bridge/types';
import { getOpenClawConfigDir } from '../utils/paths';

interface PersistedState {
  pairingCode: string | null;
  tokens: string[];
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
  private pairingCode: string | null = null;
  private readonly tokens = new Set<string>();
  private autoConnectEnabled = true;
  private installedExtensionVersion: string | null = null;

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
    this.tokens.add(token);
    this.pairingCode = null;
    this.persistState();
    return { token };
  }

  validateToken(token: string | undefined | null): boolean {
    if (!token) return false;
    return this.tokens.has(token);
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
    }
    this.persistState();
  }

  autoConnect(extensionVersion?: string): { token: string } | null {
    if (!this.autoConnectEnabled) return null;
    if (typeof extensionVersion === 'string' && extensionVersion.trim()) {
      this.installedExtensionVersion = extensionVersion.trim();
    }
    const token = randomBytes(24).toString('hex');
    this.tokens.add(token);
    this.persistState();
    return { token };
  }

  revokeAllTokens(): void {
    this.tokens.clear();
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
  }): BrowserBridgeSession {
    const session: BrowserBridgeSession = {
      sessionId: input.sessionId,
      tabId: input.tabId,
      url: input.url,
      title: input.title || '',
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      token: input.token,
      source: input.source ?? 'extension',
      embedRuntimeId: input.embedRuntimeId,
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
    });
  }

  disconnectSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.commandQueues.delete(sessionId);
  }

  heartbeat(sessionId: string, patch?: { url?: string; title?: string }): BrowserBridgeSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.lastHeartbeat = Date.now();
    if (patch?.url) session.url = patch.url;
    if (patch?.title !== undefined) session.title = patch.title;
    return session;
  }

  listActiveSessions(): BrowserBridgeSession[] {
    const now = Date.now();
    const active = Array.from(this.sessions.values()).filter(
      (session) => now - session.lastHeartbeat < BROWSER_BRIDGE_SESSION_STALE_MS,
    );
    return active.sort((left, right) => {
      const leftEmbed = left.source === 'embed' ? 0 : 1;
      const rightEmbed = right.source === 'embed' ? 0 : 1;
      if (leftEmbed !== rightEmbed) return leftEmbed - rightEmbed;
      return right.lastHeartbeat - left.lastHeartbeat;
    });
  }

  getPrimarySession(): BrowserBridgeSession | null {
    const sessions = this.listActiveSessions();
    return sessions[0] ?? null;
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
    return command;
  }

  pollCommands(sessionId: string): BrowserBridgeCommand[] {
    const queue = this.commandQueues.get(sessionId) ?? [];
    const now = Date.now();
    const pending = queue.filter((cmd) => cmd.expiresAt > now);
    this.commandQueues.set(sessionId, []);
    return pending;
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

  private loadPersistedState(): void {
    const filePath = stateFilePath();
    if (!existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      this.pairingCode = typeof parsed.pairingCode === 'string' ? parsed.pairingCode : null;
      if (Array.isArray(parsed.tokens)) {
        for (const token of parsed.tokens) {
          if (typeof token === 'string' && token) this.tokens.add(token);
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
      tokens: Array.from(this.tokens),
      autoConnectEnabled: this.autoConnectEnabled,
      installedExtensionVersion: this.installedExtensionVersion,
    };
    writeFileSync(stateFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastHeartbeat > BROWSER_BRIDGE_SESSION_STALE_MS) {
        this.sessions.delete(sessionId);
        this.commandQueues.delete(sessionId);
      }
    }
    for (const [commandId, result] of this.commandResults.entries()) {
      if (now - result.completedAt > 5 * 60 * 1000) {
        this.commandResults.delete(commandId);
      }
    }
  }
}

export const browserBridgeService = new BrowserBridgeService();
