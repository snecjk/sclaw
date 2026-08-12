import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import {
  ContentHeaderProvider,
  useContentHeader,
  useContentHeaderDisplay,
} from '@/components/layout/content-header-context';

function HeaderWriter() {
  useContentHeader({
    title: '工作流',
    actions: <button type="button">试运行</button>,
  });
  return null;
}

function HeaderReader() {
  const { title, previewActions } = useContentHeaderDisplay();
  return (
    <div>
      <span>{title}</span>
      {previewActions}
    </div>
  );
}

describe('ContentHeaderProvider registration', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not rerender a header writer in response to its own registration', () => {
    render(
      <MemoryRouter initialEntries={['/workflow/wf_1']}>
        <ContentHeaderProvider>
          <HeaderWriter />
          <HeaderReader />
        </ContentHeaderProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '试运行' })).toBeInTheDocument();
  });
});
