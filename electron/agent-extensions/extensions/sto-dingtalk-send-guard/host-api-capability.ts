import { PORTS } from '../../../utils/config';
import type {
  DingTalkPendingContext,
  DingTalkSendReservation,
  DingTalkSendReservationInput,
  StoDingTalkSendGuardPort,
} from './capability';

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined) as T | { error?: unknown } | undefined;
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `${response.status} ${response.statusText}`;
    throw new Error(error);
  }
  return payload as T;
}

export function createHostApiDingTalkSendGuardPort(): StoDingTalkSendGuardPort {
  return {
    hasPendingContext: async (sessionKey) => {
      const result = await request<{ pending: boolean }>(
        '/api/agent-extensions/dingtalk-send-guard/pending/has',
        { sessionKey },
      );
      return result.pending === true;
    },
    consumePendingContext: (sessionKey) => request<DingTalkPendingContext | null>(
      '/api/agent-extensions/dingtalk-send-guard/pending/consume',
      { sessionKey },
    ),
    reserveSend: (input: DingTalkSendReservationInput) => request<DingTalkSendReservation>(
      '/api/agent-extensions/dingtalk-send-guard/send/reserve',
      input as unknown as Record<string, unknown>,
    ),
    completeSend: async (input) => {
      await request(
        '/api/agent-extensions/dingtalk-send-guard/send/complete',
        input as unknown as Record<string, unknown>,
      );
    },
  };
}
