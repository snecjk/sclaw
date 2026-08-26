import {
  isBridgeEventAllowed,
  isValidBridgeEventName,
  normalizeBridgeEventList,
  resolveAllowedBridgeEventPatterns,
} from '../../../../shared/jsbridge/bridge-events';
import { JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION } from '../../../../shared/jsbridge/protocol';
import type { BridgeHandlerFn } from './types';
import type { BridgeSession } from '../session-registry';

export function subscribeBridgeEvents(
  session: BridgeSession,
  events: string[],
): { subscribed: string[]; denied: string[] } {
  const patterns = resolveAllowedBridgeEventPatterns(session.trustPolicy);
  const subscribed: string[] = [];
  const denied: string[] = [];

  for (const event of events) {
    if (!isValidBridgeEventName(event) || !isBridgeEventAllowed(event, patterns)) {
      denied.push(event);
      continue;
    }
    session.eventSubscriptions.add(event);
    subscribed.push(event);
  }

  return { subscribed, denied };
}

export function unsubscribeBridgeEvents(
  session: BridgeSession,
  events?: string[],
): string[] {
  if (!events?.length) {
    session.eventSubscriptions.clear();
    return [];
  }
  for (const event of events) {
    session.eventSubscriptions.delete(event);
  }
  return [...session.eventSubscriptions];
}

export const handleBridgeSubscribe: BridgeHandlerFn = async ({ session, request }) => {
  const events = normalizeBridgeEventList(
    (request.params as { events?: unknown } | undefined)?.events,
  );
  if (events.length === 0) {
    return { subscribed: [...session.eventSubscriptions], added: [] };
  }

  const { subscribed, denied } = subscribeBridgeEvents(session, events);
  if (subscribed.length === 0) {
    throw Object.assign(
      new Error(denied.length > 0 ? `Event not allowed: ${denied.join(', ')}` : 'No valid events'),
      { code: 'CAPABILITY_DENIED' },
    );
  }

  return {
    subscribed: [...session.eventSubscriptions],
    added: subscribed,
    denied,
  };
};

export const handleBridgeUnsubscribe: BridgeHandlerFn = async ({ session, request }) => {
  const events = normalizeBridgeEventList(
    (request.params as { events?: unknown } | undefined)?.events,
  );
  unsubscribeBridgeEvents(session, events.length > 0 ? events : undefined);
  return { subscribed: [...session.eventSubscriptions] };
};

export function buildBridgeEventEnvelope(
  session: BridgeSession,
  name: string,
  payload?: unknown,
) {
  return {
    protocol: JSBRIDGE_PROTOCOL,
    version: JSBRIDGE_VERSION,
    type: 'event' as const,
    sessionId: session.sessionId,
    name,
    payload,
    timestamp: Date.now(),
  };
}
