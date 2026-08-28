import { describe, expect, it } from 'vitest';
import { AI_CAPABILITIES, CONSENT_CAPABILITIES } from '../../shared/jsbridge/capabilities';
import { isBridgeAiEnabled, resolveTrustPolicy } from '../../shared/jsbridge/trust-policy';

describe('bridge AI trust policy', () => {
  it('defaults AI profile to disabled when absent', () => {
    const policy = resolveTrustPolicy({ appId: 'demo', bound: true });
    expect(isBridgeAiEnabled(policy)).toBe(false);
    expect(policy.ai).toBeUndefined();
  });

  it('passes through enabled AI profile from bridgePolicy', () => {
    const policy = resolveTrustPolicy({
      appId: 'demo',
      bound: true,
      bridgePolicy: {
        ai: {
          enabled: true,
          agentId: 'main',
          responseFormat: 'json',
        },
      },
    });
    expect(isBridgeAiEnabled(policy)).toBe(true);
    expect(policy.ai?.agentId).toBe('main');
  });

  it('registers AI capabilities in the capability union', () => {
    expect(AI_CAPABILITIES).toEqual([
      'chat.complete',
      'chat.cancel',
      'chat.invokeAgent',
    ]);
    expect(CONSENT_CAPABILITIES).toContain('chat.complete');
    expect(CONSENT_CAPABILITIES).not.toContain('chat.cancel');
  });
});
