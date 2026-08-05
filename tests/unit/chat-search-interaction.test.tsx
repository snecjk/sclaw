import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import i18n from '@/i18n';
import { ChatSearchBar } from '@/pages/Chat/ChatSearchBar';

function renderHeaderSearch(isOpen: boolean, onToggle = vi.fn(), onChange = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ChatSearchBar
          variant="header"
          isOpen={isOpen}
          onToggle={onToggle}
          value=""
          onChange={onChange}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClear={vi.fn()}
          resultCount={0}
          activeIndex={0}
        />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe('ChatSearchBar Header interaction', () => {
  it('focuses the persistent input when opening and keeps the overlay interactive', () => {
    const onToggle = vi.fn();
    const onChange = vi.fn();
    const view = renderHeaderSearch(false, onToggle, onChange);

    const input = screen.getByRole('textbox');
    expect(document.activeElement).not.toBe(input);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ChatSearchBar
            variant="header"
            isOpen
            onToggle={onToggle}
            value=""
            onChange={onChange}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
            onClear={vi.fn()}
            resultCount={0}
            activeIndex={0}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    expect(document.activeElement).toBe(input);
    expect(input.closest('.no-drag')).not.toBeNull();

    fireEvent.change(input, { target: { value: '天气' } });
    expect(onChange).toHaveBeenCalledWith('天气');

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('chat:toolbar.searchClose') }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
