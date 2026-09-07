/**
 * 引擎侧「一个会话只有一个活跃 query」的唯一 owner。
 *
 * 此前 claude-adapter 直接 `Map.set` / `Map.delete`，有两个后果：
 * 1. 同一 sessionKey 再次发送时，前一个 query 被顶掉但没人 close —— 迭代器还在跑，
 *    停止按钮只能关掉最新那个（多窗口/连点场景表现为"停不下来"）。
 * 2. 旧 query 的 finally 会无条件 delete，把已经注册的新 owner 抹掉 —— 之后
 *    abort 找不到句柄，同样停不下来。
 *
 * 注册/替换/释放/中断都必须走这里，且释放必须带 runId（只能释放自己那一格）。
 */

export interface ActiveQueryHandle {
  sessionKey: string;
  runId: string;
  sessionId: string;
  close: () => void;
}

export interface ActiveQueryRegistryHooks {
  /** 新 run 顶掉同会话的旧 run 时回调（用于日志/告警）。 */
  onReplace?: (previous: ActiveQueryHandle, next: ActiveQueryHandle) => void;
  /** close() 抛错时回调；注册流程不因此中断。 */
  onCloseError?: (handle: ActiveQueryHandle, error: unknown) => void;
}

export class ActiveQueryRegistry {
  private readonly entries = new Map<string, ActiveQueryHandle>();

  constructor(private readonly hooks: ActiveQueryRegistryHooks = {}) {}

  /**
   * 把 handle 设为该会话的唯一 owner。若存在 runId 不同的旧 owner，先 close 它，
   * 避免两个迭代器同时向同一会话发事件。
   */
  register(handle: ActiveQueryHandle): void {
    const previous = this.entries.get(handle.sessionKey);
    this.entries.set(handle.sessionKey, handle);
    if (!previous || previous.runId === handle.runId) return;

    this.hooks.onReplace?.(previous, handle);
    try {
      previous.close();
    } catch (error) {
      this.hooks.onCloseError?.(previous, error);
    }
  }

  get(sessionKey: string): ActiveQueryHandle | null {
    return this.entries.get(sessionKey) ?? null;
  }

  has(sessionKey: string): boolean {
    return this.entries.has(sessionKey);
  }

  /**
   * 释放自己那一格。runId 不匹配说明已经有更新的 run 接管，必须原样保留。
   * @returns 是否真的释放了
   */
  releaseIfCurrent(sessionKey: string, runId: string): boolean {
    const current = this.entries.get(sessionKey);
    if (!current || current.runId !== runId) return false;
    this.entries.delete(sessionKey);
    return true;
  }

  /** close 并释放当前 owner（停止按钮 / abortRun）。 */
  abort(sessionKey: string): boolean {
    const current = this.entries.get(sessionKey);
    if (!current) return false;
    this.entries.delete(sessionKey);
    try {
      current.close();
    } catch (error) {
      this.hooks.onCloseError?.(current, error);
    }
    return true;
  }
}
