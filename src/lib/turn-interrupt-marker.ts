/**
 * 用户 Stop 后标记回合已中断（Phase 6）
 *
 * 仅内存标记，供 AssistantTurnMessage 消费一次后清除。
 */
const interruptedTurnKeys = new Set<string>();

export function markTurnInterrupted(turnStableKey: string): void {
  if (!turnStableKey) return;
  interruptedTurnKeys.add(turnStableKey);
}

/** 读取并清除中断标记（每回合只展示一次） */
export function consumeTurnInterrupted(turnStableKey: string | undefined): boolean {
  if (!turnStableKey) return false;
  if (!interruptedTurnKeys.has(turnStableKey)) return false;
  interruptedTurnKeys.delete(turnStableKey);
  return true;
}

export function peekTurnInterrupted(turnStableKey: string | undefined): boolean {
  if (!turnStableKey) return false;
  return interruptedTurnKeys.has(turnStableKey);
}
