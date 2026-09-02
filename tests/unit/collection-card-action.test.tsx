import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollectionCardAction } from '@/components/ui/collection-card-action';

function renderCard() {
  const onOpen = vi.fn();
  const onSecondary = vi.fn();

  render(
    <article className="sto-collection-card">
      <h3>Card title</h3>
      <CollectionCardAction aria-label="Open Card title" onClick={onOpen} />
      <button type="button" onClick={onSecondary}>More</button>
    </article>,
  );

  return { onOpen, onSecondary };
}

describe('CollectionCardAction', () => {
  it('participates in the tab order as the primary card action', () => {
    renderCard();

    const action = screen.getByRole('button', { name: 'Open Card title' });
    expect(action.tabIndex).toBe(0);
    action.focus();
    expect(action).toHaveFocus();
  });

  it.each(['Enter', ' '])('activates once for %s', (key) => {
    const { onOpen } = renderCard();
    const action = screen.getByRole('button', { name: 'Open Card title' });

    action.focus();
    fireEvent.keyDown(action, { key });
    fireEvent.keyUp(action, { key });
    fireEvent.click(action);

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps a sibling secondary button isolated from the card action', () => {
    const { onOpen, onSecondary } = renderCard();
    const action = screen.getByRole('button', { name: 'Open Card title' });
    const secondary = screen.getByRole('button', { name: 'More' });

    expect(action.parentElement).toBe(secondary.parentElement);
    expect(action.contains(secondary)).toBe(false);
    fireEvent.click(secondary);

    expect(onSecondary).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
