import { useEffect, useRef } from 'react';
import type { RawMessage } from '@/stores/chat/types';
import {
  seedQuoteFlowCardSessionState,
  syncQuoteFlowCardSession,
} from '@/lib/quote-flow-card-session-sync';

/** Open quote business preview once per ossKey (upload done), emit bridge events at session level. */
export function useQuoteFlowCardSessionSync(sessionKey: string, messages: RawMessage[]): void {
  const seededSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionKey) return;
    if (seededSessionRef.current !== sessionKey) {
      seedQuoteFlowCardSessionState(sessionKey, messages);
      seededSessionRef.current = sessionKey;
    }
    syncQuoteFlowCardSession(sessionKey, messages);
  }, [sessionKey, messages]);
}
