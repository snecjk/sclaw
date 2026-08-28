import { invokeIpc } from '@/lib/api-client';
import { BRIDGE_EVENT_QUOTE } from '../../../shared/jsbridge/bridge-events';

export async function emitBridgeGuestEvent(input: {
  runtimeId?: string | null;
  webContentsId?: number;
  sessionId?: string;
  name: string;
  eventPayload?: unknown;
}): Promise<boolean> {
  const name = input.name.trim();
  if (!name) return false;
  const result = await invokeIpc<{ ok?: boolean; delivered?: boolean }>('bridge:emitEvent', {
    runtimeId: input.runtimeId ?? undefined,
    webContentsId: input.webContentsId,
    sessionId: input.sessionId,
    name,
    eventPayload: input.eventPayload,
  });
  return Boolean(result.ok && result.delivered);
}

export { BRIDGE_EVENT_QUOTE };
