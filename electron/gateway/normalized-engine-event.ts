type EngineEventState = 'started' | 'delta' | 'final' | 'completed' | 'error' | 'aborted';

type EngineEventBase = {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  raw?: unknown;
};

export type NormalizedEngineEvent =
  | (EngineEventBase & {
      type: 'turn.started';
    })
  | (EngineEventBase & {
      type: 'message.delta';
      message: unknown;
    })
  | (EngineEventBase & {
      type: 'message.final';
      message?: unknown;
      phase?: string;
    })
  | (EngineEventBase & {
      type: 'tool.result';
      message: unknown;
      phase?: string;
    })
  | (EngineEventBase & {
      type: 'turn.completed';
      phase?: string;
      runtimeResult?: unknown;
    })
  | (EngineEventBase & {
      type: 'turn.failed';
      errorMessage: string;
    })
  | (EngineEventBase & {
      type: 'turn.aborted';
    })
  | (EngineEventBase & {
      type: 'turn.interrupted';
      errorMessage?: string;
    });

export type LegacyChatMessagePayload = {
  message: Record<string, unknown>;
  engineEvent: NormalizedEngineEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getRawState(payload: Record<string, unknown>): EngineEventState | undefined {
  const state = payload.state;
  if (
    state === 'started'
    || state === 'delta'
    || state === 'final'
    || state === 'completed'
    || state === 'error'
    || state === 'aborted'
  ) {
    return state;
  }
  return undefined;
}

function isToolResultMessage(message: unknown): boolean {
  if (!isRecord(message)) return false;
  const role = message.role;
  return role === 'toolresult' || role === 'tool_result' || role === 'toolResult';
}

function withCommonFields(
  target: Record<string, unknown>,
  event: NormalizedEngineEvent,
): Record<string, unknown> {
  if (event.runId) target.runId = event.runId;
  if (event.sessionKey) target.sessionKey = event.sessionKey;
  if (event.seq != null) target.seq = event.seq;
  return target;
}

function withoutRaw(event: NormalizedEngineEvent): NormalizedEngineEvent {
  const { raw: _raw, ...rest } = event;
  return rest as NormalizedEngineEvent;
}

function legacyPayload(event: NormalizedEngineEvent, message: Record<string, unknown>): LegacyChatMessagePayload {
  return {
    message,
    engineEvent: withoutRaw(event),
  };
}

export function normalizeLegacyChatPayload(payload: unknown): NormalizedEngineEvent {
  if (!isRecord(payload)) {
    return { type: 'message.final', message: payload, raw: payload };
  }

  const common = {
    runId: getString(payload.runId),
    sessionKey: getString(payload.sessionKey),
    seq: getNumber(payload.seq),
    raw: payload,
  };
  const state = getRawState(payload);
  const message = payload.message;

  switch (state) {
    case 'started':
      return { ...common, type: 'turn.started' };
    case 'delta':
      return { ...common, type: 'message.delta', message };
    case 'final':
      if (isToolResultMessage(message)) {
        return { ...common, type: 'tool.result', message, phase: getString(payload.phase) };
      }
      return { ...common, type: 'message.final', message, phase: getString(payload.phase) };
    case 'completed':
      return { ...common, type: 'turn.completed', phase: getString(payload.phase) };
    case 'error':
      return {
        ...common,
        type: 'turn.failed',
        errorMessage: getString(payload.errorMessage) ?? getString(payload.error) ?? 'Engine error',
      };
    case 'aborted':
      return { ...common, type: 'turn.aborted' };
    default:
      return { ...common, type: 'message.final', message: payload };
  }
}

export function toLegacyChatMessagePayload(event: NormalizedEngineEvent): LegacyChatMessagePayload {
  switch (event.type) {
    case 'turn.started':
      return legacyPayload(event, withCommonFields({ state: 'started' }, event));
    case 'message.delta':
      return legacyPayload(event, withCommonFields({ state: 'delta', message: event.message }, event));
    case 'message.final': {
      const message = withCommonFields({ state: 'final' }, event);
      if ('message' in event) message.message = event.message;
      if (event.phase) message.phase = event.phase;
      return legacyPayload(event, message);
    }
    case 'tool.result': {
      const message = withCommonFields({ state: 'final', message: event.message }, event);
      if (event.phase) message.phase = event.phase;
      return legacyPayload(event, message);
    }
    case 'turn.completed': {
      const message = withCommonFields({ state: 'completed' }, event);
      if (event.phase) message.phase = event.phase;
      if ('runtimeResult' in event) message.runtimeResult = event.runtimeResult;
      return legacyPayload(event, message);
    }
    case 'turn.failed':
      return legacyPayload(event, withCommonFields({ state: 'error', errorMessage: event.errorMessage }, event));
    case 'turn.aborted':
      return legacyPayload(event, withCommonFields({ state: 'aborted' }, event));
    case 'turn.interrupted':
      return legacyPayload(event, withCommonFields({ state: 'error', phase: 'interrupted', errorMessage: event.errorMessage }, event));
  }
}
