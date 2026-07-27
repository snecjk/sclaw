/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidebarCollapsibleSectionLabel } from '@/components/layout/sidebar-collapsible-section-label';

describe('SidebarCollapsibleSectionLabel', () => {
  it('toggles section via main hotzone', () => {
    const onToggle = vi.fn();
    render(
      <SidebarCollapsibleSectionLabel
        open={false}
        onToggle={onToggle}
        label="项目"
        toggleAriaLabel="展开或收起项目"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开或收起项目' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not toggle section when right action is clicked', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <SidebarCollapsibleSectionLabel
        open
        onToggle={onToggle}
        label="项目"
        toggleAriaLabel="展开或收起项目"
        actions={
          <button type="button" aria-label="新建项目" onClick={onAction}>
            new
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
