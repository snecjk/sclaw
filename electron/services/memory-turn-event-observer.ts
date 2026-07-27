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
    if (event?.type === 'turn.completed') {
      void coordinator.completed(sessionKey, runId);
      return;
    }
    if (event?.type === 'turn.failed') void coordinator.failed(sessionKey, runId);
    if (event?.type === 'turn.aborted') void coordinator.aborted(sessionKey, runId);

    // OpenClaw Gateway 在 turn 完成时不发送 turn.completed / agent:completed，
    // 只发送 state=final 的 chat 事件。state=final 且 role=assistant 即代表本轮
    // 已结束；OpenClaw 会把本轮工具结果放在 assistant.toolCalls[].result 里，
    // 因此不能通过"有无 toolCalls"来判断是否结束。这里通过 toolCalls 是否携带
    // result/status 来识别 OpenClaw 风格，其他引擎的 final assistant 消息通常
    // 不带 tool_calls，依旧可以安全触发 completed。
    if (event?.type === 'message.final' && sessionKey) {
      const message = asRecord(event.message);
      const role = String(message?.role).toLowerCase();
      if (role === 'assistant') {
        const toolCalls = (message.toolCalls ?? message.tool_calls) as unknown[] | undefined;
        const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
        const hasOpenClawStyleResults = Array.isArray(toolCalls) && toolCalls.some(
          (tc) => tc && typeof tc === 'object' && (
            (tc as Record<string, unknown>).result !== undefined
            || typeof (tc as Record<string, unknown>).status === 'string'
          ),
        );
        if (hasOpenClawStyleResults || !hasToolCalls) {
          void coordinator.completed(sessionKey, runId);
        }
      }
    }
  });
}
