import { useEffect, useState } from 'react';

import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import { isLiveTurnToken, markLiveTurnToken } from '@/lib/turn-token-live';
import type { TurnTokenUsage } from '../../shared/turn-token';

interface TurnTokenUpdatedPayload {
  sessionKey: string;
  turnIndex: number;
  usage: TurnTokenUsage;
}

const GET_RETRY_DELAYS_MS = [0, 300, 1000];

/** Claude SDK 轮次 token：内存读取 + turn-token:updated 推送；仅 live 轮次展示。 */
export function useTurnTokenUsage(
  sessionKey: string | null | undefined,
  turnIndex: number,
  enabled: boolean,
): TurnTokenUsage | null {
  const [usage, setUsage] = useState<TurnTokenUsage | null>(null);

  useEffect(() => {
    if (!enabled || !sessionKey?.trim() || turnIndex < 0) {
      setUsage(null);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const fetchUsage = () => {
      if (!isLiveTurnToken(sessionKey, turnIndex)) return;
      void invokeIpc<TurnTokenUsage | null>('turn-token:get', sessionKey, turnIndex)
        .then((result) => {
          if (!cancelled && result) setUsage(result);
        })
        .catch(() => undefined);
    };

    for (const delayMs of GET_RETRY_DELAYS_MS) {
      timers.push(setTimeout(fetchUsage, delayMs));
    }

    const unsubscribe = subscribeHostEvent<TurnTokenUpdatedPayload>(
      'turn-token:updated',
      (payload) => {
        if (payload.sessionKey !== sessionKey || payload.turnIndex !== turnIndex) return;
        markLiveTurnToken(sessionKey, turnIndex);
        setUsage(payload.usage);
      },
    );

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      unsubscribe();
    };
  }, [sessionKey, turnIndex, enabled]);

  return usage;
}
