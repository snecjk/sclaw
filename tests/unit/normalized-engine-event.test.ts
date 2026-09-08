import { describe, expect, it } from 'vitest';
import {
  normalizeLegacyChatPayload,
  toLegacyChatMessagePayload,
  type NormalizedEngineEvent,
} from '../../electron/gateway/normalized-engine-event';

describe('normalized engine events', () => {
  it('converts a normalized delta event to the legacy chat payload shape', () => {
    const event: NormalizedEngineEvent = {
      type: 'message.delta',
      runId: 'run-1',
      sessionKey: 'agent:main',
      seq: 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
      },
    };

    expect(toLegacyChatMessagePayload(event)).toEqual({
      message: {
        state: 'delta',
        runId: 'run-1',
        sessionKey: 'agent:main',
        seq: 2,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
        },
      },
      engineEvent: event,
    });
  });

  it('normalizes legacy terminal states into explicit engine events', () => {
    expect(normalizeLegacyChatPayload({
      state: 'error',
      runId: 'run-2',
      sessionKey: 'agent:main',
      errorMessage: 'failed',
    })).toMatchObject({
      type: 'turn.failed',
      runId: 'run-2',
      sessionKey: 'agent:main',
      errorMessage: 'failed',
    });

    expect(normalizeLegacyChatPayload({
      state: 'aborted',
      runId: 'run-3',
      sessionKey: 'agent:main',
    })).toMatchObject({
      type: 'turn.aborted',
      runId: 'run-3',
      sessionKey: 'agent:main',
    });
  });

  it('preserves an exhausted network retry reason across the legacy bridge', () => {
    const event: NormalizedEngineEvent = {
      type: 'turn.failed',
      runId: 'run-network',
      errorMessage: 'Request timed out.',
      reason: 'network-retry-exhausted',
      retryAttempts: 2,
    };

    expect(normalizeLegacyChatPayload(toLegacyChatMessagePayload(event).message)).toMatchObject(event);
  });

  it('normalizes legacy tool result finals into a tool.result event', () => {
    const message = {
      role: 'toolresult',
      content: 'saved',
      toolCallId: 'tool-1',
    };

    expect(normalizeLegacyChatPayload({
      state: 'final',
      runId: 'run-4',
      sessionKey: 'agent:main',
      message,
    })).toMatchObject({
      type: 'tool.result',
      runId: 'run-4',
      sessionKey: 'agent:main',
      message,
    });

    expect(toLegacyChatMessagePayload({
      type: 'tool.result',
      runId: 'run-4',
      sessionKey: 'agent:main',
      message,
    })).toEqual({
      message: {
        state: 'final',
        runId: 'run-4',
        sessionKey: 'agent:main',
        message,
      },
      engineEvent: {
        type: 'tool.result',
        runId: 'run-4',
        sessionKey: 'agent:main',
        message,
      },
    });
  });

  it('keeps unknown gateway chat payloads as final messages for compatibility', () => {
    const payload = {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    };

    expect(toLegacyChatMessagePayload(normalizeLegacyChatPayload(payload))).toEqual({
      message: {
        state: 'final',
        message: payload,
      },
      engineEvent: {
        type: 'message.final',
        message: payload,
      },
    });
  });
});
