import { describe, expect, it, vi } from 'vitest';
import {
  KeyedGenerationTracker,
  KeyedSingleFlight,
  OperationCanceledError,
} from '../../electron/services/keyed-single-flight';

describe('KeyedSingleFlight', () => {
  it('coalesces concurrent starts for one workspace but not different workspaces', async () => {
    const coordinator = new KeyedSingleFlight();
    let release!: (value: string) => void;
    const firstOperation = vi.fn(() => new Promise<string>((resolve) => {
      release = resolve;
    }));
    const otherOperation = vi.fn(async () => 'other');

    const first = coordinator.run('workspace-a', firstOperation);
    const duplicate = coordinator.run('workspace-a', firstOperation);
    const other = coordinator.run('workspace-b', otherOperation);

    expect(first).toBe(duplicate);
    expect(firstOperation).toHaveBeenCalledTimes(1);
    await expect(other).resolves.toBe('other');
    release('started');
    await expect(first).resolves.toBe('started');
  });

  it('allows a retry after a failed operation settles', async () => {
    const coordinator = new KeyedSingleFlight();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce('started');

    await expect(coordinator.run('workspace-a', operation)).rejects.toThrow('failed');
    await expect(coordinator.run('workspace-a', operation)).resolves.toBe('started');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight generation and lets a new generation start', async () => {
    const coordinator = new KeyedSingleFlight();
    let release!: () => void;
    const oldStart = coordinator.run('workspace-a', async (lease) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      lease.throwIfCanceled();
      return 'old';
    });

    coordinator.cancel('workspace-a');
    const newStart = coordinator.run('workspace-a', async (lease) => {
      lease.throwIfCanceled();
      return 'new';
    });
    release();

    await expect(newStart).resolves.toBe('new');
    await expect(oldStart).rejects.toMatchObject({ name: 'OperationCanceledError' });
  });

  it('cancels every pending generation during shutdown', async () => {
    const coordinator = new KeyedSingleFlight();
    let release!: () => void;
    const pending = coordinator.run('workspace-a', async (lease) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      lease.throwIfCanceled();
      return 'old';
    });

    coordinator.cancelAll();
    release();

    await expect(pending).rejects.toMatchObject({ name: 'OperationCanceledError' });
  });

  it('aborts the active signal immediately on cancel', async () => {
    const coordinator = new KeyedSingleFlight();
    let observedSignal!: AbortSignal;
    const pending = coordinator.run('workspace-a', async (lease) => {
      observedSignal = lease.signal;
      await new Promise<void>((_resolve, reject) => {
        lease.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return 'unreachable';
    });

    coordinator.cancel('workspace-a');

    expect(observedSignal.aborted).toBe(true);
    await expect(pending).rejects.toThrow('aborted');
  });
});

describe('KeyedGenerationTracker', () => {
  it('prevents an old pipeline from overwriting a newer or stopped state', () => {
    const tracker = new KeyedGenerationTracker();
    const oldPipeline = tracker.begin('workspace-a');
    const newPipeline = tracker.begin('workspace-a');

    expect(oldPipeline.isCurrent()).toBe(false);
    expect(() => oldPipeline.throwIfCanceled()).toThrow(OperationCanceledError);
    expect(newPipeline.isCurrent()).toBe(true);

    tracker.cancel('workspace-a');
    expect(newPipeline.isCurrent()).toBe(false);
  });
});
