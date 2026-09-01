import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplatePublishConfirmDialog } from '@/components/more-apps/TemplatePublishConfirmDialog';

describe('TemplatePublishConfirmDialog', () => {
  it('renders above the app workbench and forwards confirmation', () => {
    const onConfirm = vi.fn();
    render(
      <TemplatePublishConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('z-[260]');
    expect(screen.getByText('发布模板新版本')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
