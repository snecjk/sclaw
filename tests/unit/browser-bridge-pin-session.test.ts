import { describe, expect, it } from 'vitest';
import { pinWebBridgeExtensionSession } from '../../shared/browser-bridge/pin-extension-session';
import { projectWebBridgeAgentEvent } from '../../electron/api/routes/browser-bridge-agent';
import { WEB_BRIDGE_CHAT_SESSION_KEY } from '../../shared/session-type';

describe('pinWebBridgeExtensionSession', () => {
  const embed = {
    sessionId: 'embed-runtime-1',
    tabId: -1,
    source: 'embed' as const,
  };
  const extension = {
    sessionId: 'ext-12',
    tabId: 12,
    source: 'extension' as const,
  };
  const otherTab = {
    sessionId: 'ext-44',
    tabId: 44,
    source: 'extension' as const,
  };

  it('pins the matching extension tab and never returns embed', () => {
    expect(pinWebBridgeExtensionSession([embed, extension, otherTab], 12)?.sessionId).toBe('ext-12');
    expect(pinWebBridgeExtensionSession([embed], 12)).toBeNull();
    expect(pinWebBridgeExtensionSession([embed, extension])?.sessionId).toBe('ext-12');
  });
});

describe('projectWebBridgeAgentEvent', () => {
  it('keeps message and coarse tool events for the web-bridge session only', () => {
    expect(projectWebBridgeAgentEvent({
      protocolVersion: 1,
      eventId: 'e1',
      sessionKey: WEB_BRIDGE_CHAT_SESSION_KEY,
      runId: 'run-1',
      engineType: 'pi',
      epoch: 1,
      sequence: 4,
      occurredAt: 1,
      type: 'message.delta',
      payload: { text: 'hello' },
    })).toMatchObject({ sequence: 4, type: 'message.delta', text: 'hello', runId: 'run-1' });

    expect(projectWebBridgeAgentEvent({
      protocolVersion: 1,
      eventId: 'e2',
      sessionKey: WEB_BRIDGE_CHAT_SESSION_KEY,
      runId: 'run-1',
      engineType: 'pi',
      epoch: 1,
      sequence: 5,
      occurredAt: 1,
      type: 'tool.updated',
      payload: { toolName: 'bridge_click' },
    })).toMatchObject({ toolName: 'bridge_click' });

    expect(projectWebBridgeAgentEvent({
      protocolVersion: 1,
      eventId: 'e3',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      engineType: 'pi',
      epoch: 1,
      sequence: 6,
      occurredAt: 1,
      type: 'message.delta',
      payload: { text: 'nope' },
    })).toBeNull();
  });
});
