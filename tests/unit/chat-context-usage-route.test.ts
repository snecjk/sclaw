import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdapterForSession: vi.fn(),
  getLatestForSession: vi.fn(),
  getContextUsage: vi.fn(),
  compactSession: vi.fn(),
  getHydrated: vi.fn(),
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/engines/manager', () => ({
  getAdapterForSession: (...args: unknown[]) => mocks.getAdapterForSession(...args),
  listEngineSessions: vi.fn(),
}));
vi.mock('@electron/db/repositories/chat-runtime-repository', () => ({
  getChatRuntimeRepository: () => ({ getLatestForSession: mocks.getLatestForSession }),
}));
vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => mocks.parseJsonBody(...args),
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
}));
vi.mock('@electron/services/chat-runtime-supervisor', () => ({
  getChatRuntimeSupervisor: () => ({ getHydrated: mocks.getHydrated }),
}));

describe('GET /api/chat/context-usage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAdapterForSession.mockResolvedValue({
      type: 'pi',
      chatCapabilities: { supportsContextUsage: true, supportsManualCompaction: true },
      getContextUsage: mocks.getContextUsage,
      compactSession: mocks.compactSession,
    });
    mocks.getHydrated.mockResolvedValue({ phase: 'completed', activity: null });
  });

  it('returns the SQLite snapshot without querying the live engine', async () => {
    const usage = {
      tokens: 41_000,
      contextWindow: 100_000,
      percent: 41,
      accuracy: 'exact',
      updatedAt: 200,
    };
    mocks.getLatestForSession.mockResolvedValue({ contextUsage: usage });
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    const handled = await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/chat/context-usage?sessionKey=pi%3Amain&engineType=pi'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(mocks.getLatestForSession).toHaveBeenCalledWith('pi:main');
    expect(mocks.getContextUsage).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      supported: true,
      canCompact: true,
      usage,
    });
  });

  it('preserves a persisted unknown value so it can invalidate an older renderer value', async () => {
    const usage = {
      tokens: null,
      contextWindow: null,
      percent: null,
      accuracy: 'unknown',
      updatedAt: 300,
    };
    mocks.getLatestForSession.mockResolvedValue({ contextUsage: usage });
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/chat/context-usage?sessionKey=pi%3Amain&engineType=pi'),
      { gatewayManager: {} } as never,
    );

    expect(mocks.sendJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ usage }),
    );
  });

  it('reports Claude context usage as unsupported without reading SQLite', async () => {
    mocks.getAdapterForSession.mockResolvedValue({
      type: 'claude',
      chatCapabilities: { supportsContextUsage: false, supportsManualCompaction: false },
    });
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/chat/context-usage?sessionKey=claude%3Amain&engineType=claude'),
      { gatewayManager: {} } as never,
    );

    expect(mocks.getLatestForSession).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      supported: false,
      usage: null,
    });
  });

  it('rejects manual Claude compaction before calling the adapter', async () => {
    mocks.parseJsonBody.mockResolvedValue({ sessionKey: 'claude:main', engineType: 'claude' });
    mocks.getAdapterForSession.mockResolvedValue({
      type: 'claude',
      chatCapabilities: { supportsContextUsage: false, supportsManualCompaction: false },
    });
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    await handleGatewayRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1/api/chat/compact'),
      { gatewayManager: {} } as never,
    );

    expect(mocks.compactSession).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(expect.anything(), 409, {
      success: false,
      error: 'COMPACTION_UNSUPPORTED',
    });
  });
});
