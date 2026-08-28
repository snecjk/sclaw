import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  ContentHeaderProvider,
  useContentHeaderDisplay,
} from '@/components/layout/content-header-context';
import { useWorkflowEditorContentHeader } from '@/hooks/use-workflow-editor-content-header';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function HeaderHarness({
  backDisabled,
  onBack,
}: {
  backDisabled: boolean;
  onBack: () => void;
}) {
  useWorkflowEditorContentHeader({
    workflowId: 'wf-1',
    onBack,
    backDisabled,
  });
  return null;
}

function HeaderTitle() {
  return <>{useContentHeaderDisplay().title}</>;
}

describe('useWorkflowEditorContentHeader', () => {
  it('disables and guards the fallback back button while navigation is locked', () => {
    const onBack = vi.fn();
    const view = (backDisabled: boolean) => (
      <MemoryRouter>
        <ContentHeaderProvider>
          <HeaderHarness backDisabled={backDisabled} onBack={onBack} />
          <HeaderTitle />
        </ContentHeaderProvider>
      </MemoryRouter>
    );
    const { rerender } = render(view(true));
    const back = screen.getByRole('button', { name: 'editor.backAria' });

    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();

    rerender(view(false));
    const unlockedBack = screen.getByRole('button', { name: 'editor.backAria' });
    expect(unlockedBack).toBeEnabled();
    fireEvent.click(unlockedBack);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
