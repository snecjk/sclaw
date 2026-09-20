import { describe, expect, it, vi } from 'vitest';
import {
  disposePiSession,
  type PiSessionDisposalTarget,
} from '../../electron/pi-runtime/session-disposal';

function target(options: {
  hasShutdownHandler?: boolean;
  emit?: () => Promise<void>;
  unsubscribe?: () => void;
  dispose?: () => void;
  clear?: () => void;
} = {}): PiSessionDisposalTarget {
  return {
    session: {
      hasExtensionHandlers: vi.fn(() => options.hasShutdownHandler ?? true),
      extensionRunner: {
        emit: vi.fn(options.emit ?? (async () => {})),
      } as never,
      dispose: vi.fn(options.dispose ?? (() => {})),
    },
    unsubscribe: vi.fn(options.unsubscribe ?? (() => {})),
    clearExtensionSessionState: vi.fn(options.clear ?? (() => {})),
  };
}

describe('Pi session disposal', () => {
  it('preserves chat activation state when only the runtime is reloaded', async () => {
    const subject = target();
    await disposePiSession(subject, { type: 'session_shutdown', reason: 'reload' });
    expect(subject.session.extensionRunner.emit).toHaveBeenCalledWith({ type: 'session_shutdown', reason: 'reload' });
    expect(subject.session.dispose).toHaveBeenCalledOnce();
    expect(subject.clearExtensionSessionState).not.toHaveBeenCalled();
  });

  it('awaits extension shutdown before releasing the AgentSession and framework state', async () => {
    const order: string[] = [];
    const deferred = Promise.withResolvers<void>();
    const subject = target({
      emit: async () => {
        order.push('shutdown:start');
        await deferred.promise;
        order.push('shutdown:end');
      },
      unsubscribe: () => order.push('unsubscribe'),
      dispose: () => order.push('dispose'),
      clear: () => order.push('clear'),
    });

    const disposing = disposePiSession(subject, { type: 'session_shutdown', reason: 'resume' });
    await Promise.resolve();
    expect(order).toEqual(['shutdown:start']);

    deferred.resolve();
    const result = await disposing;

    expect(order).toEqual(['shutdown:start', 'shutdown:end', 'unsubscribe', 'dispose', 'clear']);
    expect(result).toEqual({ shutdownEmitted: true, failures: [] });
  });

  it('skips the lifecycle event when no extension registered a shutdown handler', async () => {
    const subject = target({ hasShutdownHandler: false });

    const result = await disposePiSession(subject, { type: 'session_shutdown', reason: 'quit' });

    expect(subject.session.extensionRunner.emit).not.toHaveBeenCalled();
    expect(subject.unsubscribe).toHaveBeenCalledOnce();
    expect(subject.session.dispose).toHaveBeenCalledOnce();
    expect(subject.clearExtensionSessionState).toHaveBeenCalledOnce();
    expect(result).toEqual({ shutdownEmitted: false, failures: [] });
  });

  it('continues every cleanup stage after shutdown and cleanup failures', async () => {
    const subject = target({
      emit: async () => { throw new Error('shutdown failed'); },
      unsubscribe: () => { throw new Error('unsubscribe failed'); },
      dispose: () => { throw new Error('dispose failed'); },
      clear: () => { throw new Error('clear failed'); },
    });

    const result = await disposePiSession(subject, { type: 'session_shutdown', reason: 'quit' });

    expect(subject.unsubscribe).toHaveBeenCalledOnce();
    expect(subject.session.dispose).toHaveBeenCalledOnce();
    expect(subject.clearExtensionSessionState).toHaveBeenCalledOnce();
    expect(result.shutdownEmitted).toBe(true);
    expect(result.failures.map((failure) => failure.stage)).toEqual([
      'session_shutdown',
      'unsubscribe',
      'session_dispose',
      'extension_state_clear',
    ]);
  });
});
