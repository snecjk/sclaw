/**
 * 进程内的中断原因槽。supervisor 与 claude-adapter 都写、续跑时读。
 * 不放进 adapter，避免和 ChatRuntimeSupervisor 循环引用。
 *
 * 进程重启时，supervisor.initializeFromRepository 会对仍 active 的 run
 * 写入 process_restart——这是内存 Map 做不到的那条恢复路径。
 */
import type { ChatRunInterruptCause } from '../../shared/chat-run-interrupt';

const causes = new Map<string, ChatRunInterruptCause>();

export function rememberRunInterrupt(sessionKey: string, cause: ChatRunInterruptCause): void {
  if (!sessionKey) return;
  causes.set(sessionKey, cause);
}

export function consumeRunInterrupt(sessionKey: string): ChatRunInterruptCause | null {
  const value = causes.get(sessionKey) ?? null;
  causes.delete(sessionKey);
  return value;
}

export function peekRunInterrupt(sessionKey: string): ChatRunInterruptCause | null {
  return causes.get(sessionKey) ?? null;
}

export function clearRunInterrupt(sessionKey: string): void {
  causes.delete(sessionKey);
}
