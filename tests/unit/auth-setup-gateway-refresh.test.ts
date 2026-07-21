import { describe, expect, it } from 'vitest';
import { resolvePostAuthGatewayRefresh } from '@electron/services/auth-setup-orchestrator';
import type { GatewayManager } from '@electron/gateway/manager';

function mockGateway(overrides: {
  state?: 'stopped' | 'starting' | 'running' | 'reconnecting';
  connectedAt?: number;
  settling?: boolean;
}): GatewayManager {
  const connectedAt =
    overrides.connectedAt ?? Date.now() - 60_000;
  return {
    getStatus: () => ({
      state: overrides.state ?? 'running',
      connectedAt,
    }),
    isGatewayLifecycleSettling: () => overrides.settling ?? false,
    cancelPendingGatewayRefresh: () => {},
  } as unknown as GatewayManager;
}

const emptySto = { created: [], deleted: [], updated: [], defaultSet: null };
const emptyBiz = { created: [], skipped: [] };

describe('resolvePostAuthGatewayRefresh', () => {
  it('returns none on login when only plugins/sso would refresh', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'login',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({}),
        stoResult: emptySto,
        bizResult: emptyBiz,
      }),
    ).toBe('none');
  });

  it('returns reload on login when models changed and gateway is stable', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'login',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({ state: 'running' }),
        stoResult: { ...emptySto, created: ['m1'] },
        bizResult: emptyBiz,
      }),
    ).toBe('reload');
  });

  it('returns none on login while lifecycle is settling', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'login',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({ settling: true }),
        stoResult: { ...emptySto, updated: ['m1'] },
        bizResult: emptyBiz,
      }),
    ).toBe('none');
  });

  it('returns none on login shortly after connect', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'login',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({
          connectedAt: Date.now() - 1_000,
        }),
        stoResult: { ...emptySto, created: ['m1'] },
        bizResult: emptyBiz,
      }),
    ).toBe('none');
  });

  it('returns reload on account-switch when models changed and gateway is stable', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'account-switch',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({ state: 'running' }),
        stoResult: { ...emptySto, updated: ['sto-key'] },
        bizResult: emptyBiz,
      }),
    ).toBe('reload');
  });

  it('returns none on account-switch when config did not change', () => {
    expect(
      resolvePostAuthGatewayRefresh({
        source: 'account-switch',
        needsGatewayRefresh: true,
        gatewayManager: mockGateway({ state: 'running' }),
        stoResult: emptySto,
        bizResult: emptyBiz,
      }),
    ).toBe('none');
  });
});
