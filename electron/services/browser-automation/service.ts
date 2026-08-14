import type {
  BrowserAutomationActPayload,
  BrowserAutomationActResult,
  BrowserAutomationPageObservation,
  BrowserAutomationRunStatus,
  BrowserAutomationSession,
  BrowserAutomationValidatorResult,
  BrowserAutomationValidatorSpec,
  BrowserAutomationWaitCondition,
} from '../../../shared/browser-automation/types';
import { browserAutomationRepository } from '../../db/repositories/browser-automation-repository';
import { BrowserAutomationCdpSession } from './cdp-session';
import { observePage } from './observer';
import { actOnPage, validateOnPage } from './actor';
import { actFillOrType, actPressKey } from './input';
import { waitAfterAction, waitForCondition, type WaitEngineDeps } from './wait-engine';
import {
  buildEmbedSessionId,
  closeManagedSession,
  createManagedSession,
  isSessionExpired,
  logSessionEvent,
  navigateWebContents,
  parseEmbedRuntimeId,
  resolveEmbedWebContents,
  resolveSessionWebContents,
} from './session-manager';
import { getSclawEmbedBrowserNetworkLog } from '../../main/services/sclaw-embed-browser-runtime';

interface LiveSession extends BrowserAutomationSession {
  webContentsId: number | null;
}

export class BrowserAutomationService {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly cdpByWebContentsId = new Map<number, BrowserAutomationCdpSession>();

  async createSession(input: {
    embedRuntimeId?: string;
    url?: string;
    showManaged?: boolean;
  }): Promise<BrowserAutomationSession> {
    if (input.embedRuntimeId) {
      const sessionId = buildEmbedSessionId(input.embedRuntimeId);
      const wc = resolveEmbedWebContents(input.embedRuntimeId);
      if (!wc || wc.isDestroyed()) {
        throw new Error(`Embed browser runtime is not ready: ${input.embedRuntimeId}`);
      }
      const session = this.registerLiveSession({
        sessionId,
        source: 'embed',
        embedRuntimeId: input.embedRuntimeId,
        url: wc.getURL(),
        title: wc.getTitle(),
        webContentsId: wc.id,
        automationPinned: true,
      });
      await browserAutomationRepository.upsertSession({
        sessionId,
        source: 'embed',
        embedRuntimeId: input.embedRuntimeId,
        url: session.url,
        title: session.title,
        webContentsId: wc.id,
        automationPinned: true,
      });
      return session;
    }

    if (!input.url) {
      throw new Error('url is required when embedRuntimeId is not provided');
    }

    const { sessionId, webContents: wc } = await createManagedSession({
      url: input.url,
      show: input.showManaged,
    });
    const session = this.registerLiveSession({
      sessionId,
      source: 'managed',
      url: wc.getURL(),
      title: wc.getTitle(),
      webContentsId: wc.id,
      automationPinned: true,
    });
    await browserAutomationRepository.upsertSession({
      sessionId,
      source: 'managed',
      url: session.url,
      title: session.title,
      webContentsId: wc.id,
      automationPinned: true,
    });
    logSessionEvent('managed session created', { sessionId, url: input.url });
    return session;
  }

  listSessions(): BrowserAutomationSession[] {
    this.pruneExpiredSessions();
    return Array.from(this.sessions.values()).map((session) => this.publicSession(session));
  }

  getSession(sessionId: string): BrowserAutomationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
      this.disposeSession(sessionId);
      return null;
    }
    return this.publicSession(session);
  }

  async startRun(sessionId: string, input?: { runId?: string; workflowRunId?: string | null }): Promise<string> {
    this.requireSession(sessionId);
    return browserAutomationRepository.createRun({
      runId: input?.runId,
      sessionId,
      workflowRunId: input?.workflowRunId ?? null,
    });
  }

  async observe(sessionId: string): Promise<BrowserAutomationPageObservation> {
    const deps = this.requireDeps(sessionId);
    return observePage(
      sessionId,
      deps.cdp,
      deps.executeJavaScript,
      { networkState: deps.networkState, pendingRequests: deps.pendingRequests },
    );
  }

  async act(
    sessionId: string,
    payload: BrowserAutomationActPayload,
    runId?: string,
  ): Promise<BrowserAutomationActResult> {
    const session = this.requireSession(sessionId);
    const deps = this.requireDeps(sessionId);
    const stepIndex = runId ? await this.nextStepIndex(runId) : 0;
    const started = Date.now();
    const observationBefore = await this.observe(sessionId);

    let result: BrowserAutomationActResult;
    if (payload.action === 'navigate' && payload.url) {
      await navigateWebContents(deps.webContents, payload.url);
      await waitAfterAction(deps.waitDeps, { source: session.source, action: 'navigate' });
      result = { success: true, action: 'navigate' };
    } else if (payload.action === 'fill') {
      result = await actFillOrType({
        cdp: deps.cdp,
        executeJavaScript: deps.executeJavaScript,
        payload,
      });
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    } else if (payload.action === 'press') {
      result = await actPressKey({
        cdp: deps.cdp,
        executeJavaScript: deps.executeJavaScript,
        payload,
      });
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    } else {
      result = await actOnPage(deps.executeJavaScript, payload);
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    }

    const observationAfter = result.success ? await this.observe(sessionId) : observationBefore;
    result.observation = observationAfter;

    if (runId) {
      await browserAutomationRepository.upsertStepRun({
        runId,
        stepIndex,
        action: payload.action,
        status: result.success ? 'SUCCEEDED' : 'FAILED',
        payloadJson: JSON.stringify(payload),
        observationJson: JSON.stringify({ before: observationBefore, after: observationAfter }),
        error: result.error ?? null,
        durationMs: Date.now() - started,
        completedAt: new Date().toISOString(),
      });
      if (!result.success) {
        await browserAutomationRepository.completeRun(runId, 'FAILED', result.error ?? 'act failed');
      }
    }

    this.touchSession(session);
    return result;
  }

  async wait(
    sessionId: string,
    condition: BrowserAutomationWaitCondition,
  ): Promise<{ success: boolean; message: string }> {
    const deps = this.requireDeps(sessionId);
    return waitForCondition(deps.waitDeps, condition);
  }

  async validate(
    sessionId: string,
    spec: BrowserAutomationValidatorSpec,
    runId?: string,
  ): Promise<BrowserAutomationValidatorResult> {
    const session = this.requireSession(sessionId);
    const deps = this.requireDeps(sessionId);
    const result = await validateOnPage(deps.executeJavaScript, spec);

    if (runId) {
      const stepIndex = await this.nextStepIndex(runId);
      await browserAutomationRepository.upsertStepRun({
        runId,
        stepIndex,
        action: 'validate',
        status: result.passed ? 'SUCCEEDED' : 'FAILED',
        validatorJson: JSON.stringify({ spec, result }),
        error: result.passed ? null : result.message,
        completedAt: new Date().toISOString(),
      });
      if (!result.passed) {
        await browserAutomationRepository.completeRun(runId, 'FAILED', result.message);
      }
    }

    this.touchSession(session);
    return result;
  }

  async completeRun(runId: string, status: BrowserAutomationRunStatus = 'SUCCEEDED'): Promise<void> {
    await browserAutomationRepository.completeRun(runId, status);
  }

  async captureScreenshot(sessionId: string): Promise<Buffer> {
    const deps = this.requireDeps(sessionId);
    return deps.cdp.captureScreenshot();
  }

  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.source === 'managed') {
      closeManagedSession(sessionId);
    }
    if (session.webContentsId) {
      const cdp = this.cdpByWebContentsId.get(session.webContentsId);
      void cdp?.detach();
      this.cdpByWebContentsId.delete(session.webContentsId);
    }
    this.sessions.delete(sessionId);
  }

  private registerLiveSession(input: Omit<LiveSession, 'createdAt' | 'lastActiveAt'>): LiveSession {
    const now = Date.now();
    const session: LiveSession = {
      ...input,
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private publicSession(session: LiveSession): BrowserAutomationSession {
    return {
      sessionId: session.sessionId,
      source: session.source,
      embedRuntimeId: session.embedRuntimeId,
      url: session.url,
      title: session.title,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      automationPinned: session.automationPinned,
    };
  }

  private touchSession(session: LiveSession): void {
    session.lastActiveAt = Date.now();
    const wc = resolveSessionWebContents(session);
    if (wc && !wc.isDestroyed()) {
      session.url = wc.getURL();
      session.title = wc.getTitle();
      session.webContentsId = wc.id;
    }
  }

  private pruneExpiredSessions(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
        this.disposeSession(sessionId);
      }
    }
  }

  private requireSession(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser automation session not found: ${sessionId}`);
    }
    if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
      this.disposeSession(sessionId);
      throw new Error(`Browser automation session expired: ${sessionId}`);
    }
    return session;
  }

  private requireDeps(sessionId: string) {
    const session = this.requireSession(sessionId);
    const wc = resolveSessionWebContents(session);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`Browser webContents is not ready for session: ${sessionId}`);
    }

    let cdp = this.cdpByWebContentsId.get(wc.id);
    if (!cdp) {
      cdp = new BrowserAutomationCdpSession(wc);
      this.cdpByWebContentsId.set(wc.id, cdp);
    }

    const embedRuntimeId = session.embedRuntimeId ?? parseEmbedRuntimeId(sessionId) ?? undefined;
    const pendingRequests = embedRuntimeId
      ? getSclawEmbedBrowserNetworkLog(embedRuntimeId).filter((event) => event.timestamp > Date.now() - 2000).length
      : 0;

    const executeJavaScript = async (script: string) => wc.executeJavaScript(script, true);
    const waitDeps: WaitEngineDeps = {
      webContents: wc,
      executeJavaScript,
      getPendingRequestCount: () => pendingRequests,
    };

    return {
      webContents: wc,
      cdp,
      executeJavaScript,
      waitDeps,
      pendingRequests,
      networkState: wc.isLoading() || pendingRequests > 0 ? 'loading' as const : 'idle' as const,
    };
  }

  private async nextStepIndex(runId: string): Promise<number> {
    const steps = await browserAutomationRepository.listStepRuns(runId);
    if (steps.length === 0) return 0;
    const max = Math.max(...steps.map((step) => Number(step.step_index ?? 0)));
    return max + 1;
  }
}

export const browserAutomationService = new BrowserAutomationService();
