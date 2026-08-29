import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeController } from '@/components/theme/ThemeController';
import {
  applyResolvedAppearance,
  postResolvedAppearance,
  STO_APPEARANCE_MESSAGE_TYPE,
} from '@/components/theme/appearance-context';
import { SidebarBrandHeader } from '@/components/layout/sidebar-brand-header';

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

  it('shares the resolved appearance with the sidebar without another media subscription', () => {
    const matchMedia = vi.mocked(window.matchMedia);
    matchMedia.mockClear();

    render(
      <ThemeController>
        <SidebarBrandHeader
          layoutVariant="full"
          onCollapse={vi.fn()}
          collapseLabel="Collapse sidebar"
          expandLabel="Expand sidebar"
        />
      </ThemeController>,
    );

    expect(screen.getByRole('img', { name: 'SClaw' })).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledTimes(2);
  });
});
