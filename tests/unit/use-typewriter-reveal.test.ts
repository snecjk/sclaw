import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTypewriterReveal,
  TYPEWRITER_MAX_DURATION_MS,
} from '@/hooks/use-typewriter-reveal';

describe('useTypewriterReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exports 2s cap for all typewriter modules', () => {
    expect(TYPEWRITER_MAX_DURATION_MS).toBe(2000);
  });

  it('snaps to full current text after max duration during active typing', async () => {
    const longText = 'x'.repeat(800);
    const { result, rerender } = renderHook(
      ({ text, enabled }) => useTypewriterReveal(text, enabled, { resetKey: 'block-1' }),
      { initialProps: { text: longText, enabled: true } },
    );

    expect(result.current.text.length).toBeLessThan(longText.length);

    await act(async () => {
      vi.advanceTimersByTime(TYPEWRITER_MAX_DURATION_MS + 100);
      await Promise.resolve();
    });

    rerender({ text: longText, enabled: true });

    expect(result.current.text).toBe(longText);
    expect(result.current.isAnimating).toBe(false);
  });

  it('shows subsequent increments instantly after cap is exceeded', async () => {
    const initial = 'a'.repeat(600);
    const extended = `${initial}bbbb`;

    const { result, rerender } = renderHook(
      ({ text, enabled }) => useTypewriterReveal(text, enabled, { resetKey: 'block-2' }),
      { initialProps: { text: initial, enabled: true } },
    );

    await act(async () => {
      vi.advanceTimersByTime(TYPEWRITER_MAX_DURATION_MS + 100);
      await Promise.resolve();
    });

    rerender({ text: extended, enabled: true });

    expect(result.current.text).toBe(extended);
  });
});
