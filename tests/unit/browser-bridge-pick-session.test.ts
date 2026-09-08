import { describe, expect, it } from 'vitest';
import {
  EMPTY_BRIDGE_SESSIONS_HINT,
  formatBridgeSessionList,
  normalizeBridgeSessionId,
  pickBridgeSession,
} from '../../shared/browser-bridge/pick-session';

const embed = { sessionId: 'embed-rt', tabId: -1, source: 'embed' as const };
const extension = { sessionId: 'ext-1-uuid', tabId: 12, source: 'extension' as const };

describe('normalizeBridgeSessionId', () => {
  it('drops invented placeholders so navigate can ensure-session', () => {
    expect(normalizeBridgeSessionId('auto')).toBeUndefined();
    expect(normalizeBridgeSessionId(' AUTO ')).toBeUndefined();
    expect(normalizeBridgeSessionId('current')).toBeUndefined();
    expect(normalizeBridgeSessionId('ext-464165774')).toBe('ext-464165774');
    expect(normalizeBridgeSessionId('embed-rt')).toBe('embed-rt');
  });
});

describe('formatBridgeSessionList', () => {
  it('does not return a bare empty array', () => {
    expect(formatBridgeSessionList([])).toEqual({
      sessions: [],
      actionHint: EMPTY_BRIDGE_SESSIONS_HINT,
    });
    expect(formatBridgeSessionList([extension]).sessions).toEqual([extension]);
  });
});

describe('pickBridgeSession', () => {
  it('prefers Chrome extension over embed when sessionId is omitted', () => {
    expect(pickBridgeSession([embed, extension])).toEqual(extension);
  });

  it('treats sessionId auto as omitted and still prefers Chrome', () => {
    expect(pickBridgeSession([embed, extension], { sessionId: 'auto' })).toEqual(extension);
  });

  it('keeps embed when embedOnly or embed sessionId is requested', () => {
    expect(pickBridgeSession([embed, extension], { embedOnly: true })).toEqual(embed);
    expect(pickBridgeSession([embed, extension], { sessionId: 'embed-rt' })).toEqual(embed);
  });
});
