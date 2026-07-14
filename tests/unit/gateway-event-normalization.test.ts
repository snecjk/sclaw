import { describe, expect, it } from 'vitest';
import {
  buildAgentNotificationEngineEvent,
  buildChatEventFromEngineEvent,
  buildGatewayChatMessageEvent,
  buildNotificationChatEvent,
} from '@/stores/chat/gateway-event-normalization';

describe('gateway event normalization', () => {
  it('normalizes agent notification chat payloads', () => {
    const event = buildNotificationChatEvent({
      params: {
        runId: 'run-1',
        sessionKey: 'agent:main:session-1',
        state: 'delta',
        message: { role: 'assistant', content: 'hello' },
        seq: 3,
      },
      data: {
        runId: 'stale-run',
        state: 'final',
      },
    });

    expect(event).toMatchObject({
      runId: 'run-1',
      sessionKey: 'agent:main:session-1',
      state: 'delta',
      seq: 3,
      message: { role: 'assistant', content: 'hello' },
    });
  });

  it('returns null for notifications without chat data', () => {
    expect(buildNotificationChatEvent({
      params: { runId: 'run-1' },
      data: { phase: 'started' },
    })).toBeNull();
  });

  it('normalizes agent notification phases into engine events', () => {
    expect(buildAgentNotificationEngineEvent({
      params: {
        runId: 'run-start',
        sessionKey: 'agent:main',
        phase: 'start',
      },
      data: {},
    })).toEqual({
      type: 'turn.started',
      runId: 'run-start',
      sessionKey: 'agent:main',
      phase: 'start',
    });

    expect(buildAgentNotificationEngineEvent({
      params: {
        runId: 'run-done',
        sessionKey: 'agent:main',
      },
      data: {
        phase: 'finished',
        runtimeResult: { stopReason: 'end_turn' },
      },
    })).toEqual({
      type: 'turn.completed',
      runId: 'run-done',
      sessionKey: 'agent:main',
      phase: 'finished',
      runtimeResult: { stopReason: 'end_turn' },
    });
  });

  it('maps normalized turn.completed events to completed chat events', () => {
    expect(buildChatEventFromEngineEvent({
      type: 'turn.completed',
      runId: 'run-complete',
      sessionKey: 'agent:main',
      phase: 'done',
      runtimeResult: { type: 'result' },
    })).toMatchObject({
      state: 'completed',
      runId: 'run-complete',
      sessionKey: 'agent:main',
      phase: 'done',
      runtimeResult: { type: 'result' },
    });
  });

  it('normalizes wrapped chat messages with explicit state', () => {
    const event = buildGatewayChatMessageEvent({
      runId: 'outer-run',
      message: {
        state: 'delta',
        runId: 'inner-run',
        sessionKey: 'agent:main:session-2',
        message: { role: 'assistant', content: 'chunk' },
      },
    });

    expect(event).toMatchObject({
      state: 'delta',
      runId: 'inner-run',
      sessionKey: 'agent:main:session-2',
      message: { role: 'assistant', content: 'chunk' },
    });
  });

  it('prefers normalized engine events when both event shapes are present', () => {
    const event = buildGatewayChatMessageEvent({
      message: {
        state: 'delta',
        runId: 'legacy-run',
        message: { role: 'assistant', content: 'legacy' },
      },
      engineEvent: {
        type: 'message.delta',
        runId: 'run-1',
        sessionKey: 'agent:main',
        seq: 4,
        message: { role: 'assistant', content: 'normalized' },
      },
    });

    expect(event).toMatchObject({
      state: 'delta',
      runId: 'run-1',
      sessionKey: 'agent:main',
      seq: 4,
      message: { role: 'assistant', content: 'normalized' },
    });
  });

  it('maps normalized tool result events back to final chat events', () => {
    const event = buildGatewayChatMessageEvent({
      engineEvent: {
        type: 'tool.result',
        runId: 'run-tool',
        sessionKey: 'agent:main',
        message: { role: 'toolresult', content: 'ok' },
      },
    });

    expect(event).toMatchObject({
      state: 'final',
      runId: 'run-tool',
      sessionKey: 'agent:main',
      message: { role: 'toolresult', content: 'ok' },
    });
  });

  it('treats untyped chat messages as final snapshots', () => {
    const event = buildGatewayChatMessageEvent({
      runId: 'run-2',
      sessionKey: 'agent:main:session-3',
      message: { role: 'assistant', content: 'done' },
    });

    expect(event).toMatchObject({
      state: 'final',
      runId: 'run-2',
      sessionKey: 'agent:main:session-3',
      message: { role: 'assistant', content: 'done' },
    });
  });
});
