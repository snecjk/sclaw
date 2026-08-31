import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarBrandHeader } from '@/components/layout/sidebar-brand-header';

describe('SidebarBrandHeader macOS provincial chrome', () => {
  it('keeps the collapse control in the chrome row instead of the logo row', () => {
    const onCollapse = vi.fn();

    render(
      <SidebarBrandHeader
        layoutVariant="provincial"
        onCollapse={onCollapse}
        collapseLabel="Collapse sidebar"
        expandLabel="Expand sidebar"
      />,
    );

    const logo = screen.getByAltText('SClaw');
    const collapseButton = screen.getByRole('button', { name: 'Collapse sidebar' });
    const logoRow = logo.parentElement?.parentElement?.parentElement;

    expect(collapseButton.parentElement).not.toBe(logoRow);
    expect(collapseButton.parentElement?.className).toContain(
      'min-h-[var(--sto-sidebar-chrome-h)]',
    );

    fireEvent.click(collapseButton);
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
