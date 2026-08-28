import { describe, expect, it, vi } from 'vitest';
import {
  applyResolvedAppearance,
  postResolvedAppearance,
  STO_APPEARANCE_MESSAGE_TYPE,
} from '@/components/theme/ThemeController';

describe('theme controller appearance helpers', () => {
  it('applies class, data attribute, and color scheme together', () => {
    const root = document.documentElement;
    applyResolvedAppearance(root, 'dark');

    expect(root).toHaveClass('dark');
    expect(root).not.toHaveClass('light');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('uses an SClaw-owned message name', () => {
    expect(STO_APPEARANCE_MESSAGE_TYPE).toBe('sto:appearance-change');
  });

  it('posts the resolved appearance to a preview window', () => {
    const postMessage = vi.fn();
    postResolvedAppearance({ postMessage } as unknown as Window, 'light');

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'sto:appearance-change', appearance: 'light' },
      '*',
    );
  });
});
