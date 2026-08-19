import { webContents, type WebContents } from 'electron';
import type { Capability } from '../../../../shared/jsbridge/capabilities';
import {
  CONSENT_CAPABILITIES,
  mergeCapabilities,
} from '../../../../shared/jsbridge/capabilities';
import { JSBRIDGE_ORIGIN_POLICY } from '../../../../shared/jsbridge/config';
import {
  isStoCnOrigin,
  matchAnyOriginPattern,
  originFromUrl,
} from '../../../../shared/jsbridge/origin-policy';
import type { BridgeBootstrap } from '../../../../shared/jsbridge/protocol';
import type { BridgeContainerKind, ResolveTrustPolicyInput } from '../../../../shared/jsbridge/trust-policy';
import { resolveTrustPolicy } from '../../../../shared/jsbridge/trust-policy';
import { hasBridgeConsent } from './consent-store';
import { issueSessionToken, newSessionId } from './auth-service';
import { abortBridgeAiRunsForWebContents } from './bridge-ai-registry';
import { logger } from '../../../utils/logger';

export interface BridgeSession {
  sessionId: string;
  runtimeId: string | null;
  webContentsId: number;
  containerKind: BridgeContainerKind;
  containerRef: string;
  trustPolicy: ReturnType<typeof resolveTrustPolicy>;
  bindOrigin: string;
  currentOrigin: string | null;
  sessionToken: string;
  grantedCapabilities: Set<Capability>;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  destroyed: boolean;
  destroyReason?: string;
  invokeCount: number;
  rateWindowStart: number;
  navigationGuardInstalled: boolean;
}

export interface CreateBridgeSessionInput extends ResolveTrustPolicyInput {
  runtimeId: string | null;
  webContentsId: number;
  pageUrl: string;
  containerKind?: BridgeContainerKind;
  containerRef?: string;
}

const sessions = new Map<string, BridgeSession>();
const byWebContentsId = new Map<number, string>();
const byRuntimeId = new Map<string, string>();

function resolveWebContents(webContentsId: number): WebContents | null {
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return null;
  return wc;
}

function computeExpiresAt(trustPolicy: ReturnType<typeof resolveTrustPolicy>): number {
  const ttl = trustPolicy.trustTier === 'untrusted'
    ? JSBRIDGE_ORIGIN_POLICY.untrustedSessionTtlMs
    : JSBRIDGE_ORIGIN_POLICY.sessionTtlMs;
  return Date.now() + ttl;
}

function buildGrantedCapabilities(trustPolicy: ReturnType<typeof resolveTrustPolicy>): Set<Capability> {
  const caps = mergeCapabilities(trustPolicy.trustTier, trustPolicy.capabilities);
  const granted = new Set<Capability>();
  for (const cap of caps) {
    if ((CONSENT_CAPABILITIES as readonly string[]).includes(cap)) {
      if (hasBridgeConsent(trustPolicy.appId, cap)) {
        granted.add(cap);
      }
      continue;
    }
    granted.add(cap);
  }
  return granted;
}

function attachNavigationGuard(session: BridgeSession): void {
  if (session.navigationGuardInstalled) return;
  const wc = resolveWebContents(session.webContentsId);
  if (!wc) return;

  const onNavigate = (_event: Electron.Event, url: string) => {
    const origin = originFromUrl(url);
    if (!origin || !isStoCnOrigin(origin)) {
      destroyBridgeSession(session.sessionId, 'origin_not_sto_cn');
      return;
    }
    if (!matchAnyOriginPattern(session.trustPolicy.allowedOrigins, origin)) {
      destroyBridgeSession(session.sessionId, 'origin_not_in_app_policy');
      return;
    }
    session.currentOrigin = origin;
  };

  wc.on('did-navigate', onNavigate);
  wc.on('did-navigate-in-page', onNavigate);
  session.navigationGuardInstalled = true;
}

export function createBridgeSession(input: CreateBridgeSessionInput): BridgeSession | null {
  const origin = originFromUrl(input.pageUrl);
  if (!origin || !isStoCnOrigin(origin)) {
    logger.info('[jsbridge] skip session: non-sto.cn origin', {
      pageUrl: input.pageUrl,
      appId: input.appId,
    });
    return null;
  }

  const trustPolicy = resolveTrustPolicy(input);
  if (!matchAnyOriginPattern(trustPolicy.allowedOrigins, origin)) {
    logger.info('[jsbridge] skip session: origin not in app policy', {
      origin,
      appId: trustPolicy.appId,
    });
    return null;
  }

  const existingRuntimeSessionId = input.runtimeId ? byRuntimeId.get(input.runtimeId) : undefined;
  if (existingRuntimeSessionId) {
    destroyBridgeSession(existingRuntimeSessionId, 'rebind');
  }

  const existingWcSessionId = byWebContentsId.get(input.webContentsId);
  if (existingWcSessionId) {
    destroyBridgeSession(existingWcSessionId, 'rebind');
  }

  const sessionId = newSessionId();
  const expiresAt = computeExpiresAt(trustPolicy);
  const session: BridgeSession = {
    sessionId,
    runtimeId: input.runtimeId,
    webContentsId: input.webContentsId,
    containerKind: input.containerKind ?? 'webview',
    containerRef: input.containerRef ?? input.runtimeId ?? sessionId,
    trustPolicy,
    bindOrigin: origin,
    currentOrigin: origin,
    sessionToken: '',
    grantedCapabilities: buildGrantedCapabilities(trustPolicy),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    expiresAt,
    destroyed: false,
    invokeCount: 0,
    rateWindowStart: Date.now(),
    navigationGuardInstalled: false,
  };

  session.sessionToken = issueSessionToken({
    sessionId,
    webContentsId: input.webContentsId,
    bindOrigin: origin,
    expiresAt,
  });

  sessions.set(sessionId, session);
  byWebContentsId.set(input.webContentsId, sessionId);
  if (input.runtimeId) {
    byRuntimeId.set(input.runtimeId, sessionId);
  }

  attachNavigationGuard(session);
  return session;
}

export function getBridgeSession(sessionId: string): BridgeSession | null {
  const session = sessions.get(sessionId);
  if (!session || session.destroyed) return null;
  return session;
}

export function getBridgeSessionByWebContentsId(webContentsId: number): BridgeSession | null {
  const sessionId = byWebContentsId.get(webContentsId);
  if (!sessionId) return null;
  return getBridgeSession(sessionId);
}

export function getBridgeSessionByRuntimeId(runtimeId: string): BridgeSession | null {
  const sessionId = byRuntimeId.get(runtimeId);
  if (!sessionId) return null;
  return getBridgeSession(sessionId);
}

export function toBridgeBootstrap(session: BridgeSession): BridgeBootstrap {
  return {
    protocol: 'stoclaw-bridge/v1',
    version: '1.0.0',
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    appId: session.trustPolicy.appId === '__untrusted__' ? null : session.trustPolicy.appId,
    capabilities: [...session.grantedCapabilities],
  };
}

export function destroyBridgeSession(sessionId: string, reason?: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.destroyed) return;
  session.destroyed = true;
  session.destroyReason = reason;

  abortBridgeAiRunsForWebContents(session.webContentsId);

  byWebContentsId.delete(session.webContentsId);
  if (session.runtimeId) {
    byRuntimeId.delete(session.runtimeId);
  }

  const wc = resolveWebContents(session.webContentsId);
  if (wc && !wc.isDestroyed()) {
    try {
      wc.send('jsbridge:event', {
        protocol: 'stoclaw-bridge/v1',
        version: '1.0.0',
        type: 'event',
        sessionId: session.sessionId,
        name: 'bridge:session-destroyed',
        payload: { reason },
        timestamp: Date.now(),
      });
    } catch {
      // guest may be gone
    }
  }

  sessions.delete(sessionId);
}

export function destroyBridgeSessionsForRuntime(runtimeId: string): void {
  const sessionId = byRuntimeId.get(runtimeId);
  if (sessionId) {
    destroyBridgeSession(sessionId, 'runtime_unregistered');
  }
}

export function destroyAllBridgeSessions(reason: string): void {
  for (const sessionId of [...sessions.keys()]) {
    destroyBridgeSession(sessionId, reason);
  }
}

export function refreshBridgeSessionOrigin(session: BridgeSession, pageUrl: string): boolean {
  const origin = originFromUrl(pageUrl);
  if (!origin || !isStoCnOrigin(origin)) {
    destroyBridgeSession(session.sessionId, 'origin_not_sto_cn');
    return false;
  }
  if (!matchAnyOriginPattern(session.trustPolicy.allowedOrigins, origin)) {
    destroyBridgeSession(session.sessionId, 'origin_not_in_app_policy');
    return false;
  }
  session.currentOrigin = origin;
  return true;
}

export function grantCapabilityToSession(sessionId: string, capability: Capability): boolean {
  const session = getBridgeSession(sessionId);
  if (!session) return false;
  session.grantedCapabilities.add(capability);
  return true;
}

export function listActiveBridgeSessions(): BridgeSession[] {
  return [...sessions.values()].filter((session) => !session.destroyed);
}
