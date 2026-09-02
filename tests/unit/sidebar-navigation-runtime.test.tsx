import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SidebarNavLink,
} from '@/components/layout/Sidebar';
import { resolveSidebarPrimaryNavActiveOverride } from '@/lib/sidebar-primary-nav-active';
import { SidebarRecentSessionRow } from '@/components/layout/sidebar-recent-session-row';
import { SidebarProjectSessionRow } from '@/components/layout/sidebar-project-session-row';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useSessionUnreadStore } from '@/stores/session-unread';

const noop = vi.fn();
const session = { key: 'session-one', label: 'Session one' };

function renderNavLink({
  path,
  to,
  isActiveOverride,
  collapsed = false,
}: {
  path: string;
  to: string;
  isActiveOverride?: boolean;
  collapsed?: boolean;
}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarNavLink
          to={to}
          end
          icon={<svg aria-hidden />}
          label="Navigation item"
          collapsed={collapsed}
          isActiveOverride={isActiveOverride}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useChatStore.setState({ currentSessionKey: 'main' });
  useSessionUnreadStore.setState({ unreadKeys: {}, readAt: {} });
});

describe('Sidebar navigation runtime state', () => {
  it('marks My Tasks current on a Workflow route through its custom active override', () => {
    const isActiveOverride = resolveSidebarPrimaryNavActiveOverride({
      to: '/my-tasks',
      pathname: '/workflow',
      currentSessionKey: 'main',
      pendingProjectId: null,
    });
    renderNavLink({ path: '/workflow', to: '/my-tasks', isActiveOverride });

    expect(screen.getByRole('link', { name: 'Navigation item' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['non-default session', 'agent:main:session-one', null],
    ['pending project', 'main', 'project-one'],
  ] as const)('keeps Home non-current for a %s override', (_case, currentSessionKey, pendingProjectId) => {
    const isActiveOverride = resolveSidebarPrimaryNavActiveOverride({
      to: '/',
      pathname: '/',
      currentSessionKey,
      pendingProjectId,
    });
    renderNavLink({ path: '/', to: '/', isActiveOverride });

    expect(screen.getByRole('link', { name: 'Navigation item' }))
      .not.toHaveAttribute('aria-current');
  });

  it('uses the Navigation recipe in expanded and collapsed geometry', () => {
    const expanded = renderNavLink({ path: '/', to: '/', isActiveOverride: true });
    expect(screen.getByRole('link', { name: 'Navigation item' })).toHaveClass('sto-navigation-item');
    expanded.unmount();

    renderNavLink({ path: '/', to: '/', isActiveOverride: true, collapsed: true });
    const collapsed = screen.getByRole('link', { name: 'Navigation item' });
    expect(collapsed).toHaveClass('sto-navigation-item', 'sto-navigation-item--collapsed');
    expect(collapsed.className).toContain('h-[var(--sto-sidebar-collapsed-nav-item-h)]');
    expect(collapsed.className).toContain('w-[var(--sto-sidebar-collapsed-nav-item-w)]');
  });
});

const sharedRowProps = {
  session,
  label: 'Session one',
  isActive: true,
  isPinned: false,
  isEditing: false,
  editingValue: '',
  onOpen: noop,
  onPin: noop,
  onStartRename: noop,
  onEditingValueChange: noop,
  onCommitRename: noop,
  onCancelRename: noop,
  onDelete: noop,
};

describe('Sidebar session accessibility state', () => {
  it.each([
    ['recent', SidebarRecentSessionRow],
    ['project', SidebarProjectSessionRow],
  ] as const)('puts current state on the %s row primary button', (_family, Row) => {
    useChatStore.setState({ currentSessionKey: session.key });
    render(<Row {...sharedRowProps} />);

    const primary = screen.getByRole('button', { name: 'Session one' });
    const shell = primary.parentElement;
    expect(primary).toHaveAttribute('aria-current', 'page');
    expect(shell).toHaveAttribute('data-selected', 'true');
    expect(shell).not.toHaveAttribute('aria-current');
  });
});
