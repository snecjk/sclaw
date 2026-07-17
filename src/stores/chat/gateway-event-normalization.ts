export function buildNotificationChatEvent(input: {
  params: Record<string, unknown>;
  data: Record<string, unknown>;
}): Record<string, unknown> | null {
  const { data, params } = input;
  const hasChatData = (params.state ?? data.state) || (params.message ?? data.message);
  if (!hasChatData) return null;

  return {
    ...data,
    runId: params.runId ?? data.runId,
    sessionKey: params.sessionKey ?? data.sessionKey,
    stream: params.stream ?? data.stream,
    seq: params.seq ?? data.seq,
    state: params.state ?? data.state,
    message: params.message ?? data.message,
  };
}

export function buildAgentNotificationEngineEvent(input: {
  params: Record<string, unknown>;
  data: Record<string, unknown>;
}): Record<string, unknown> | null {
  const { data, params } = input;
  const phase = data.phase ?? params.phase;
  const runId = params.runId ?? data.runId;
  const sessionKey = params.sessionKey ?? data.sessionKey;
  const runtimeResult = params.runtimeResult ?? data.runtimeResult;

  switch (phase) {
    case 'started':
    case 'start':
      if (runId == null || sessionKey == null) return null;
      return {
        type: 'turn.started',
        runId,
        sessionKey,
        phase,
      };
    case 'completed':
    case 'done':
    case 'finished':
    case 'end':
      return {
        type: 'turn.completed',
        runId,
        sessionKey,
        phase,
        runtimeResult,
      };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildChatEventFromEngineEvent(
  engineEvent: Record<string, unknown>,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const type = engineEvent.type;
  switch (type) {
    case 'turn.started':
      return {
        ...fallback,
        state: 'started',
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    case 'message.delta':
      return {
        ...fallback,
        state: 'delta',
        message: engineEvent.message,
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    case 'message.final':
    case 'tool.result':
      return {
        ...fallback,
        state: 'final',
        message: engineEvent.message ?? fallback.message,
        phase: engineEvent.phase ?? fallback.phase,
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    case 'turn.completed':
      return {
        ...fallback,
        state: 'completed',
        phase: engineEvent.phase ?? fallback.phase,
        runtimeResult: engineEvent.runtimeResult ?? fallback.runtimeResult,
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    case 'turn.failed':
      return {
        ...fallback,
        state: 'error',
        errorMessage: engineEvent.errorMessage ?? fallback.errorMessage,
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    case 'turn.aborted':
      return {
        ...fallback,
        state: 'aborted',
        runId: engineEvent.runId ?? fallback.runId,
        sessionKey: engineEvent.sessionKey ?? fallback.sessionKey,
        seq: engineEvent.seq ?? fallback.seq,
      };
    default:
      return null;
  }
}

export function buildGatewayChatMessageEvent(data: unknown): Record<string, unknown> {
  const chatData = isRecord(data) ? data : {};
  const payload = ('message' in chatData && isRecord(chatData.message))
    ? chatData.message as Record<string, unknown>
    : chatData;
  const fromEngineEvent = isRecord(chatData.engineEvent)
    ? buildChatEventFromEngineEvent(chatData.engineEvent, { ...chatData, ...payload })
    : null;
  if (fromEngineEvent) return fromEngineEvent;

  if (payload.state != null) {
    return {
      ...chatData,
      ...payload,
      state: payload.state,
      message: payload.message ?? chatData.message,
      runId: payload.runId ?? chatData.runId,
      sessionKey: payload.sessionKey ?? chatData.sessionKey,
      seq: payload.seq ?? chatData.seq,
      stream: payload.stream ?? chatData.stream,
    };
  }

  return {
    ...chatData,
    state: chatData.state ?? payload.state ?? 'final',
    message: payload,
    runId: chatData.runId ?? payload.runId,
    sessionKey: chatData.sessionKey ?? payload.sessionKey,
    seq: chatData.seq ?? payload.seq,
    stream: chatData.stream ?? payload.stream,
  };
}
