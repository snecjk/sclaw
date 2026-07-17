/**
 * Skill Plaza cache primitives
 *
 * Small, dependency-free helpers used by SkillPlazaService to cut repeated
 * remote calls within and across load cycles. Kept separate so the service
 * file stays focused on aggregation logic.
 */

/**
 * A single-value cache with TTL, stale-while-revalidate access and in-flight
 * request de-duplication. Concurrent `get()` calls share one loader promise.
 */
export class TtlCache<T> {
  private entry?: { value: T; expiresAt: number };
  private inflight?: Promise<T>;

  constructor(private readonly ttlMs: number) {}

  /** Return the cached value only if it is still fresh. */
  peekFresh(): T | undefined {
    if (this.entry && Date.now() <= this.entry.expiresAt) {
      return this.entry.value;
    }
    return undefined;
  }

  /** Return the last cached value regardless of freshness (may be stale). */
  peekStale(): T | undefined {
    return this.entry?.value;
  }

  set(value: T): void {
    this.entry = { value, expiresAt: Date.now() + this.ttlMs };
  }

  invalidate(): void {
    this.entry = undefined;
    this.inflight = undefined;
  }

  /**
   * Return a fresh cached value if present; otherwise run `loader` (sharing a
   * single in-flight promise across concurrent callers) and cache its result.
   */
  async get(loader: () => Promise<T>): Promise<T> {
    const fresh = this.peekFresh();
    if (fresh !== undefined) return fresh;

    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const value = await loader();
        this.set(value);
        return value;
      } finally {
        this.inflight = undefined;
      }
    })();

    return this.inflight;
  }
}

/**
 * Keyed variant of {@link TtlCache}. Each distinct key holds its own cache
 * entry and in-flight promise. Useful for values that depend on a parameter
 * (e.g. Apollo config keyed by config name).
 */
export class KeyedTtlCache<T> {
  private readonly caches = new Map<string, TtlCache<T>>();

  constructor(private readonly ttlMs: number) {}

  private cacheFor(key: string): TtlCache<T> {
    let cache = this.caches.get(key);
    if (!cache) {
      cache = new TtlCache<T>(this.ttlMs);
      this.caches.set(key, cache);
    }
    return cache;
  }

  peekFresh(key: string): T | undefined {
    return this.caches.get(key)?.peekFresh();
  }

  get(key: string, loader: () => Promise<T>): Promise<T> {
    return this.cacheFor(key).get(loader);
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.caches.clear();
      return;
    }
    this.caches.get(key)?.invalidate();
  }
}

/**
 * Run async tasks with a bounded concurrency limit, preserving input order in
 * the returned results array.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  if (items.length === 0) return [];
  const results = new Array<O>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
