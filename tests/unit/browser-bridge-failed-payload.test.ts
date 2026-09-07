import { describe, expect, it } from 'vitest';
import {
  annotateFailedToolPayload,
  annotateHealedSession,
  isFailedToolPayload,
} from '../../shared/browser-bridge/failed-payload';
import { parseChromeTabIdFromBridgeSessionId } from '../../shared/browser-bridge/session-id';

describe('failed tool payload', () => {
  it('marks success:false as an error and adds an action hint', () => {
    expect(isFailedToolPayload({ success: true })).toBe(false);
    const annotated = annotateFailedToolPayload({
      success: false,
      error: 'SESSION_STALE',
      currentSessionId: 'ext-1',
    }) as { actionHint: string };
    expect(isFailedToolPayload(annotated)).toBe(true);
    expect(annotated.actionHint).toContain('list_sessions');
  });

  it('preserves a failure-site actionHint (STALE_REF 附观测)', () => {
    const annotated = annotateFailedToolPayload({
      success: false,
      error: 'STALE_REF',
      actionHint: '用本次返回 observation.elements 里的新 @e 直接重试',
      observation: { elements: [{ ref: '@e1', role: 'generic' }], documentGeneration: 2 },
    }) as { actionHint: string; observation: { elements: unknown[] } };
    expect(annotated.actionHint).toContain('新 @e');
    expect(annotated.observation.elements).toHaveLength(1);
  });
});

describe('annotateHealedSession', () => {
  it('tells the model when the command ran on a different session', () => {
    const healed = annotateHealedSession(
      { success: true, ref: '@e31', stableKey: '177fe414' },
      'ext-1892768778',
      'ext-464165454-f5c3a61c',
    ) as { actionHint: string; healedSessionId: string; requestedSessionId: string };
    expect(healed.healedSessionId).toBe('ext-464165454-f5c3a61c');
    expect(healed.requestedSessionId).toBe('ext-1892768778');
    expect(healed.actionHint).toContain('不存在');
    expect(healed.actionHint).toContain('不要再猜测会话 ID');
  });

  it('leaves the payload untouched when no substitution happened', () => {
    const payload = { success: true };
    expect(annotateHealedSession(payload, 'ext-1', 'ext-1')).toBe(payload);
    expect(annotateHealedSession(payload, undefined, 'ext-1')).toBe(payload);
  });

  it('wraps non-object results instead of dropping the note', () => {
    const healed = annotateHealedSession('plain text', 'ext-1', 'ext-2') as { result: string };
    expect(healed.result).toBe('plain text');
  });
});

describe('parseChromeTabIdFromBridgeSessionId', () => {
  it('reads stable and legacy extension session ids', () => {
    expect(parseChromeTabIdFromBridgeSessionId('ext-464165454')).toBe(464165454);
    expect(parseChromeTabIdFromBridgeSessionId('ext-12-deadbeef')).toBe(12);
    expect(parseChromeTabIdFromBridgeSessionId('embed-rt')).toBeNull();
  });
});
