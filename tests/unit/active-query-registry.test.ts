// @vitest-environment node
/**
 * R1a：一个会话只有一个活跃 query 的 owner 语义。
 * 覆盖两个真实事故形态——旧 query 被顶掉却没 close、旧 query 的 finally 抹掉新 owner。
 */
import { describe, expect, it, vi } from 'vitest';
import { ActiveQueryRegistry } from '../../electron/engines/active-query-registry';

function handle(sessionKey: string, runId: string, close = vi.fn()) {
  return { sessionKey, runId, sessionId: `sdk-${runId}`, close };
}

describe('ActiveQueryRegistry', () => {
  it('closes the superseded run when a new run takes the slot', () => {
    const onReplace = vi.fn();
    const registry = new ActiveQueryRegistry({ onReplace });
    const first = handle('s1', 'run-1');
    const second = handle('s1', 'run-2');

    registry.register(first);
    registry.register(second);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect(registry.get('s1')?.runId).toBe('run-2');
    expect(onReplace).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      expect.objectContaining({ runId: 'run-2' }),
    );
  });

  it('re-registering the same runId (recovery query) does not close itself', () => {
    const registry = new ActiveQueryRegistry();
    const original = handle('s1', 'run-1');
    const recovery = handle('s1', 'run-1');

    registry.register(original);
    registry.register(recovery);

    expect(original.close).not.toHaveBeenCalled();
    expect(registry.get('s1')?.sessionId).toBe(recovery.sessionId);
  });

  it('keeps the newer owner when a stale run releases its slot', () => {
    const registry = new ActiveQueryRegistry();
    registry.register(handle('s1', 'run-1'));
    registry.register(handle('s1', 'run-2'));

    expect(registry.releaseIfCurrent('s1', 'run-1')).toBe(false);
    expect(registry.get('s1')?.runId).toBe('run-2');

    expect(registry.releaseIfCurrent('s1', 'run-2')).toBe(true);
    expect(registry.has('s1')).toBe(false);
  });

  it('abort closes and clears the current owner, and is a no-op when idle', () => {
    const registry = new ActiveQueryRegistry();
    const only = handle('s1', 'run-1');
    registry.register(only);

    expect(registry.abort('s1')).toBe(true);
    expect(only.close).toHaveBeenCalledTimes(1);
    expect(registry.has('s1')).toBe(false);
    expect(registry.abort('s1')).toBe(false);
  });

  it('survives a throwing close() and still swaps the owner', () => {
    const onCloseError = vi.fn();
    const registry = new ActiveQueryRegistry({ onCloseError });
    const broken = handle('s1', 'run-1', vi.fn(() => {
      throw new Error('already closed');
    }));

    registry.register(broken);
    registry.register(handle('s1', 'run-2'));

    expect(onCloseError).toHaveBeenCalledTimes(1);
    expect(registry.get('s1')?.runId).toBe('run-2');
  });

  it('keeps sessions isolated', () => {
    const registry = new ActiveQueryRegistry();
    const a = handle('s1', 'run-1');
    const b = handle('s2', 'run-2');
    registry.register(a);
    registry.register(b);

    expect(a.close).not.toHaveBeenCalled();
    expect(registry.get('s1')?.runId).toBe('run-1');
    expect(registry.get('s2')?.runId).toBe('run-2');
  });
});
