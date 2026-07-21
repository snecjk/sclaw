import type { GatewayManager } from '../gateway/manager';
import { getMemoryTurnCoordinator } from './memory-turn-coordinator';

const registeredManagers = new WeakSet<GatewayManager>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function registerMemoryTurnEventObserver(gatewayManager: GatewayManager): void {
  if (registeredManagers.has(gatewayManager)) return;
  registeredManagers.add(gatewayManager);
  const coordinator = getMemoryTurnCoordinator(gatewayManager);

  gatewayManager.on('notification', (value: unknown) => {
    const notification = asRecord(value);
    const params = asRecord(notification?.params);
    if (notification?.method !== 'agent' || params?.phase !== 'completed') return;
    void coordinator.completed(
      typeof params.sessionKey === 'string' ? params.sessionKey : null,
      typeof params.runId === 'string' ? params.runId : null,
    );
  });

  gatewayManager.on('chat:message', (value: unknown) => {
    const payload = asRecord(value);
    const event = asRecord(payload?.engineEvent);
    const sessionKey = typeof event?.sessionKey === 'string' ? event.sessionKey : null;
    const runId = typeof event?.runId === 'string' ? event.runId : null;
    if (event?.type === 'turn.failed') void coordinator.failed(sessionKey, runId);
    if (event?.type === 'turn.aborted') void coordinator.aborted(sessionKey, runId);
  });
}
