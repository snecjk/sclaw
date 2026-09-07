import { describe, expect, it } from 'vitest';
import { pickBridgeSession } from '../../shared/browser-bridge/pick-session';

const embed = { sessionId: 'embed-rt', tabId: -1, source: 'embed' as const };
const extension = { sessionId: 'ext-1-uuid', tabId: 12, source: 'extension' as const };

describe('pickBridgeSession', () => {
  it('prefers Chrome extension over embed when sessionId is omitted', () => {
    expect(pickBridgeSession([embed, extension])).toEqual(extension);
  });

  it('keeps embed when embedOnly or embed sessionId is requested', () => {
    expect(pickBridgeSession([embed, extension], { embedOnly: true })).toEqual(embed);
    expect(pickBridgeSession([embed, extension], { sessionId: 'embed-rt' })).toEqual(embed);
  });
});
