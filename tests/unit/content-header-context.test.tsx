import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import {
  ContentHeaderProvider,
  useContentHeader,
  useContentHeaderDisplay,
  useContentHeaderSplitLayout,
} from '@/components/layout/content-header-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function HeaderWriter() {
  useContentHeader({
    title: '工作流',
    actions: <button type="button">试运行</button>,
  });
  return null;
}

function RegistrationHeaderReader() {
  const { title, previewActions } = useContentHeaderDisplay();
  return (
    <div>
      <span>{title}</span>
      {previewActions}
    </div>
  );
}

function DynamicHeaderPage() {
  const [count, setCount] = useState(0);
  useContentHeader({
    title: <span>Conversation {count}</span>,
    actions: (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Action {count}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  });
  return <button type="button" onClick={() => setCount((value) => value + 1)}>Update</button>;
}

function DynamicHeaderReader() {
  const { title, actions } = useContentHeaderDisplay();
  return <header>{title}{actions}</header>;
}

function LayoutAncestor({ children }: { children: ReactNode }) {
  const isSplitLayout = useContentHeaderSplitLayout();
  return <main data-split={String(isSplitLayout)}>{children}</main>;
}

describe('ContentHeaderProvider', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not rerender a header writer in response to its own registration', () => {
    render(
      <MemoryRouter initialEntries={['/workflow/wf_1']}>
        <ContentHeaderProvider>
          <HeaderWriter />
          <RegistrationHeaderReader />
        </ContentHeaderProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '试运行' })).toBeInTheDocument();
  });

  it('replaces unstable React-node slots without recursively clearing the provider', () => {
    render(
      <MemoryRouter>
        <ContentHeaderProvider>
          <LayoutAncestor>
            <DynamicHeaderPage />
            <DynamicHeaderReader />
          </LayoutAncestor>
        </ContentHeaderProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Conversation 0')).toBeTruthy();
    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByText('Conversation 1')).toBeTruthy();
    expect(screen.getByText('Action 1')).toBeTruthy();
  });
});
