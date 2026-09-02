import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SclawBrowserEmbedChatSessions } from '@/components/sclaw-browser/SclawBrowserEmbedChatSessions';

describe('SclawBrowserEmbedChatSessions dark appearance', () => {
  it('uses the shared neutral menu selection state for the current conversation', async () => {
    render(
      <SclawBrowserEmbedChatSessions
        chatSessionKey="active-session"
        chatSessions={[
          { key: 'active-session', title: '新建报价', createdAt: 1_756_690_000_000, updatedAt: 1_756_694_700_000 },
          { key: 'other-session', title: '对话 2', createdAt: 1_756_690_000_000, updatedAt: 1_756_691_100_000 },
        ]}
        createChatSession={vi.fn()}
        switchChatSession={vi.fn()}
        deleteChatSession={vi.fn()}
        refreshChatSessions={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '历史对话' }), {
      button: 0,
      ctrlKey: false,
    });

    const activeItem = (await screen.findByText('新建报价')).closest('[role="menuitem"]');
    expect(activeItem).toHaveAttribute('aria-selected', 'true');
    expect(activeItem).not.toHaveClass('bg-accent');
  });
});
