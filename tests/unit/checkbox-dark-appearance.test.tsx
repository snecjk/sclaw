import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconCheckbox } from '@/components/icon-checkbox';
import { StartupRunDialog } from '@/pages/WorkflowDesigner/components/startup-run-dialog';

describe('checkbox dark appearance', () => {
  it('provides a theme-aware unchecked visual for shared icon checkboxes', () => {
    render(<IconCheckbox checked={false} onCheckedChange={vi.fn()} aria-label="选择产物" />);

    const checkbox = screen.getByRole('checkbox', { name: '选择产物' });
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(checkbox.querySelector('[data-sto-checkbox-theme="dark"]')).toHaveClass(
      'sto-checkbox-dark-visual',
      'bg-transparent',
    );
  });

  it('marks workflow native checkboxes for the shared dark appearance recipe', () => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockImplementation(
      () => new Promise(() => undefined),
    );

    render(
      <StartupRunDialog
        open
        schema={{
          nodeId: 'start',
          enabled: true,
          steps: [],
          fields: [
            {
              key: 'enabled',
              label: '启用校验',
              group: 'default',
              order: 1,
              component: 'checkbox',
            },
          ],
        }}
        defaultValues={{}}
        isStarting={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: '启用校验' })).toHaveClass(
      'sto-native-checkbox',
    );
  });
});
