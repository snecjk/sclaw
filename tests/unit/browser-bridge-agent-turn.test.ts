import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_BRIDGE_CHAT_SESSION_KEY } from '../../shared/session-type';

const mocks = vi.hoisted(() => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
  sendNoContent: vi.fn(),
  validateToken: vi.fn(),
  listActiveSessions: vi.fn(),
  getExtensionSession: vi.fn(),
  beginChromeConsent: vi.fn(),
  getChromeConsent: vi.fn(),
  waitForChromeConsent: vi.fn(),
  enqueueControlAttach: vi.fn(),
  waitForExtensionSession: vi.fn(),
  submitModelTurn: vi.fn(),
  getChatRuntimeSupervisor: vi.fn(),
  isBrowserAutomationEnabled: vi.fn(() => true),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => mocks.parseJsonBody(...args),
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
  sendNoContent: (...args: unknown[]) => mocks.sendNoContent(...args),
}));
vi.mock('@electron/services/browser-bridge-service', () => ({
  browserBridgeService: {
    validateToken: (...args: unknown[]) => mocks.validateToken(...args),
    listActiveSessions: (...args: unknown[]) => mocks.listActiveSessions(...args),
    getExtensionSession: (...args: unknown[]) => mocks.getExtensionSession(...args),
    beginChromeConsent: (...args: unknown[]) => mocks.beginChromeConsent(...args),
    getChromeConsent: (...args: unknown[]) => mocks.getChromeConsent(...args),
    waitForChromeConsent: (...args: unknown[]) => mocks.waitForChromeConsent(...args),
    enqueueControlAttach: (...args: unknown[]) => mocks.enqueueControlAttach(...args),
    waitForExtensionSession: (...args: unknown[]) => mocks.waitForExtensionSession(...args),
    getSettings: () => ({ autoConnectEnabled: true, installedExtensionVersion: null }),
    checkExtensionCompatibility: () => ({ compatible: true }),
  },
}));
vi.mock('@electron/services/submit-model-turn', () => ({
  submitModelTurn: (...args: unknown[]) => mocks.submitModelTurn(...args),
}));
vi.mock('@electron/services/chat-runtime-supervisor', () => ({
  getChatRuntimeSupervisor: (...args: unknown[]) => mocks.getChatRuntimeSupervisor(...args),
}));
vi.mock('@electron/engines/manager', () => ({
  getAdapterForSession: vi.fn(),
}));
vi.mock('@electron/services/memory-turn-coordinator', () => ({
  getMemoryTurnCoordinator: () => ({ aborted: vi.fn() }),
}));
vi.mock('@electron/utils/browser-bridge-extension', () => ({
  getBundledBrowserBridgeExtensionVersion: () => '1.0.0',
  launchGoogleChrome: () => false,
  prepareBrowserBridgeExtensionInstall: async () => ({}),
  resolveBrowserBridgeExtensionZipPath: () => null,
}));
vi.mock('@electron/utils/auxiliary-browser-window', () => ({
  isAuxiliaryBrowserWindowUrl: () => false,
}));
vi.mock('../../../shared/browser-automation/feature-flag', () => ({
  isBrowserAutomationEnabled: () => mocks.isBrowserAutomationEnabled(),
}));
vi.mock('../../shared/browser-automation/feature-flag', () => ({
  isBrowserAutomationEnabled: () => mocks.isBrowserAutomationEnabled(),
}));

function request(input: {
  method: string;
  remoteAddress?: string;
  token?: string;
}): IncomingMessage {
  return {
    method: input.method,
    socket: { remoteAddress: input.remoteAddress ?? '127.0.0.1' },
    headers: input.token ? { 'x-session-token': input.token } : {},
  } as IncomingMessage;
}

function response(): ServerResponse {
  return {
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

const ctx = { gatewayManager: {}, eventBus: { emit: vi.fn() }, mainWindow: null } as never;

describe('POST /api/browser-bridge/agent-turn', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isBrowserAutomationEnabled.mockReturnValue(true);
    mocks.getChatRuntimeSupervisor.mockReturnValue({ on: vi.fn(), off: vi.fn() });
    mocks.listActiveSessions.mockReturnValue([]);
    mocks.getExtensionSession.mockReturnValue(null);
  });

  it('rejects missing token', async () => {
    mocks.validateToken.mockReturnValue(false);
    const { handleBrowserBridgeRoutes } = await import('@electron/api/routes/browser-bridge');
    await handleBrowserBridgeRoutes(
      request({ method: 'POST' }),
      response(),
      new URL('http://127.0.0.1/api/browser-bridge/agent-turn'),
      ctx,
    );
    expect(mocks.submitModelTurn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 403, {
      success: false,
      error: 'Invalid session token',
    });
  });

  it('rejects non-loopback requests even with a token', async () => {
    mocks.validateToken.mockReturnValue(true);
    const { handleBrowserBridgeRoutes } = await import('@electron/api/routes/browser-bridge');
    await handleBrowserBridgeRoutes(
      request({ method: 'POST', remoteAddress: '8.8.8.8', token: 'tok' }),
      response(),
      new URL('http://127.0.0.1/api/browser-bridge/agent-turn'),
      ctx,
    );
    expect(mocks.submitModelTurn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 403, {
      success: false,
      error: 'Agent turn is localhost-only',
    });
  });

  it('pins the extension session and never submits embed', async () => {
    mocks.validateToken.mockReturnValue(true);
    mocks.parseJsonBody.mockResolvedValue({
      prompt: '打开当前页的设置',
      tabId: 12,
      url: 'https://example.com',
      title: 'Example',
    });
    mocks.listActiveSessions.mockReturnValue([
      { sessionId: 'embed-runtime-1', tabId: -1, source: 'embed', url: 'https://embed.local', title: 'embed' },
      { sessionId: 'ext-12', tabId: 12, source: 'extension', url: 'https://example.com', title: 'Example' },
    ]);
    mocks.submitModelTurn.mockResolvedValue({ success: true, result: { runId: 'run-1' } });
    const { handleBrowserBridgeRoutes } = await import('@electron/api/routes/browser-bridge');

    await handleBrowserBridgeRoutes(
      request({ method: 'POST', token: 'tok' }),
      response(),
      new URL('http://127.0.0.1/api/browser-bridge/agent-turn'),
      ctx,
    );

    expect(mocks.submitModelTurn).toHaveBeenCalledWith(ctx.gatewayManager, expect.objectContaining({
      sessionKey: WEB_BRIDGE_CHAT_SESSION_KEY,
      runtimePolicy: { origin: 'bridge', ownerId: 'web-bridge' },
      systemPromptAppend: expect.stringContaining('ext-12'),
    }));
    const append = mocks.submitModelTurn.mock.calls[0][1].systemPromptAppend as string;
    expect(append).not.toContain('embed-runtime-1');
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      success: true,
      sessionKey: WEB_BRIDGE_CHAT_SESSION_KEY,
      sessionId: 'ext-12',
      runId: 'run-1',
    }));
  });
});
