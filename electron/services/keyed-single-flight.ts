/** Coalesces concurrent operations for the same key without caching completed results. */
export class OperationCanceledError extends Error {
  constructor() {
    super('Operation was canceled');
    this.name = 'OperationCanceledError';
  }
}

export interface KeyedOperationLease {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  throwIfCanceled(): void;
}

export interface KeyedGenerationLease {
  isCurrent(): boolean;
  throwIfCanceled(): void;
}

/** Invalidates older asynchronous pipelines whenever a newer one begins. */
export class KeyedGenerationTracker {
  private readonly generations = new Map<string, number>();

  begin(key: string): KeyedGenerationLease {
    const generation = this.advance(key);
    return {
      isCurrent: () => this.generations.get(key) === generation,
      throwIfCanceled() {
        if (!this.isCurrent()) throw new OperationCanceledError();
      },
    };
  }

  cancel(key: string): void {
    this.advance(key);
  }

  private advance(key: string): number {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }
}

export class KeyedSingleFlight {
  private readonly inFlight = new Map<string, {
    promise: Promise<unknown>;
    controller: AbortController;
  }>();
  private readonly generations = new Map<string, number>();

  run<T>(key: string, operation: (lease: KeyedOperationLease) => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing.promise as Promise<T>;

    const generation = this.generations.get(key) ?? 0;
    const controller = new AbortController();
    const lease: KeyedOperationLease = {
      signal: controller.signal,
      isCurrent: () => (
        !controller.signal.aborted
        && (this.generations.get(key) ?? 0) === generation
      ),
      throwIfCanceled() {
        if (!this.isCurrent()) throw new OperationCanceledError();
      },
    };
    const task = operation(lease).finally(() => {
      if (this.inFlight.get(key)?.promise === task) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, { promise: task, controller });
    return task;
  }

  cancel(key: string): void {
    this.inFlight.get(key)?.controller.abort();
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.inFlight.delete(key);
  }

  cancelAll(): void {
    const keys = new Set([...this.generations.keys(), ...this.inFlight.keys()]);
    for (const key of keys) this.cancel(key);
  }
}
