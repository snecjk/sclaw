import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TtlCache,
  KeyedTtlCache,
  mapWithConcurrency,
} from '@electron/services/skill-plaza-cache';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a cached value while fresh without re-running the loader', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn(async () => 42);

    expect(await cache.get(loader)).toBe(42);
    expect(await cache.get(loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent loads into a single loader call', async () => {
    const cache = new TtlCache<number>(1000);
    let resolveLoader: (v: number) => void = () => {};
    const loader = vi.fn(
      () => new Promise<number>((resolve) => { resolveLoader = resolve; }),
    );

    const p1 = cache.get(loader);
    const p2 = cache.get(loader);
    resolveLoader(7);

    expect(await p1).toBe(7);
    expect(await p2).toBe(7);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL expires', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn(async () => Math.random());

    await cache.get(loader);
    vi.advanceTimersByTime(1001);
    await cache.get(loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('peekFresh returns undefined once stale but peekStale keeps the value', async () => {
    const cache = new TtlCache<string>(1000);
    await cache.get(async () => 'hello');

    expect(cache.peekFresh()).toBe('hello');
    vi.advanceTimersByTime(1001);
    expect(cache.peekFresh()).toBeUndefined();
    expect(cache.peekStale()).toBe('hello');
  });

  it('does not cache a rejected loader and retries on the next call', async () => {
    const cache = new TtlCache<string>(1000);
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce('ok');

    await expect(cache.get(loader)).rejects.toThrow('not ready');
    // A failed load must not be cached, so the next call retries and succeeds.
    expect(await cache.get(loader)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the cached value', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn(async () => 1);

    await cache.get(loader);
    cache.invalidate();
    await cache.get(loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('KeyedTtlCache', () => {
  it('keeps independent entries per key', async () => {
    const cache = new KeyedTtlCache<string>(1000);
    const loadA = vi.fn(async () => 'a');
    const loadB = vi.fn(async () => 'b');

    expect(await cache.get('A', loadA)).toBe('a');
    expect(await cache.get('B', loadB)).toBe('b');
    expect(await cache.get('A', loadA)).toBe('a');

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('invalidate(key) only clears that key, invalidate() clears all', async () => {
    const cache = new KeyedTtlCache<number>(1000);
    const loadA = vi.fn(async () => 1);
    const loadB = vi.fn(async () => 2);

    await cache.get('A', loadA);
    await cache.get('B', loadB);

    cache.invalidate('A');
    await cache.get('A', loadA);
    await cache.get('B', loadB);
    expect(loadA).toHaveBeenCalledTimes(2);
    expect(loadB).toHaveBeenCalledTimes(1);

    cache.invalidate();
    await cache.get('B', loadB);
    expect(loadB).toHaveBeenCalledTimes(2);
  });
});

describe('mapWithConcurrency', () => {
  it('returns an empty array for empty input', async () => {
    const worker = vi.fn(async (n: number) => n);
    expect(await mapWithConcurrency([], 4, worker)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('preserves input order in results', async () => {
    const input = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(input, 2, async (n) => {
      await new Promise((r) => setTimeout(r, (5 - n) * 2));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const input = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(input, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('runs all items when the limit exceeds the item count', async () => {
    const worker = vi.fn(async (n: number) => n * 2);
    const results = await mapWithConcurrency([1, 2], 10, worker);
    expect(results).toEqual([2, 4]);
    expect(worker).toHaveBeenCalledTimes(2);
  });
});
