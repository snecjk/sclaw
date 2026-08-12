import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
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

function HeaderReader() {
  const { title, actions } = useContentHeaderDisplay();
  return <header>{title}{actions}</header>;
}

function LayoutAncestor({ children }: { children: ReactNode }) {
  const isSplitLayout = useContentHeaderSplitLayout();
  return <main data-split={String(isSplitLayout)}>{children}</main>;
}

describe('ContentHeaderProvider', () => {
  it('replaces unstable React-node slots without recursively clearing the provider', () => {
    render(
      <MemoryRouter>
        <ContentHeaderProvider>
          <LayoutAncestor>
            <DynamicHeaderPage />
            <HeaderReader />
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
