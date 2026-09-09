import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { PreviewOverlayBackdrop } from '@/components/layout/preview-overlay-backdrop';

function Harness({ active = true }: { active?: boolean }) {
  const [open, setOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  return <div data-app-shell="provincial">
    <aside><button>Sidebar</button></aside>
    <main>
      <div data-slot="chat-header-zone"><button>Chat title</button></div>
      <div data-slot="preview-header-zone"><button>Preview tab</button></div>
      <div data-preview-background><textarea aria-label="Draft" defaultValue="Keep this draft" /></div>
      <div ref={panelRef} tabIndex={-1} data-preview-overlay-panel={active && open || undefined}>
        <button>Preview action</button><iframe title="Preview frame" />
      </div>
      <PreviewOverlayBackdrop active={active && open} panelRef={panelRef} onClose={() => setOpen(false)} />
    </main>
  </div>;
}

describe('preview overlay interaction', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });
  it('blocks the background and closes on backdrop click without clearing the draft', () => {
    render(<Harness />);
    expect(document.querySelector('aside')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument();
    expect(document.querySelector('aside')).not.toHaveAttribute('inert');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this draft');
  });

  it('closes with Escape, but gives a nested dialog the first Escape', () => {
    render(<Harness />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Close preview' })).toBeInTheDocument();
    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument();
  });

  it('keeps the frame mounted across presentation changes and restores focus', async () => {
    const view = render(<Harness active={false} />);
    const frame = screen.getByTitle('Preview frame');
    screen.getByRole('textbox').focus();
    expect(screen.getByRole('textbox')).toHaveFocus();
    view.rerender(<Harness />);
    expect(screen.getByRole('button', { name: 'Preview tab' })).toHaveFocus();
    view.rerender(<Harness active={false} />);
    expect(screen.getByTitle('Preview frame')).toBe(frame);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument();
  });

  it('skips inactive browser frames when cycling focus backwards', () => {
    render(<Harness />);
    const activeFrame = screen.getByTitle('Preview frame');
    const hiddenFrame = document.createElement('iframe');
    hiddenFrame.style.visibility = 'hidden';
    activeFrame.after(hiddenFrame);
    const firstControl = screen.getByRole('button', { name: 'Preview tab' });
    firstControl.focus();
    fireEvent.keyDown(firstControl, { key: 'Tab', shiftKey: true });
    expect(activeFrame).toHaveFocus();
  });

  it('handles Escape originating in a same-origin preview frame', () => {
    render(<Harness />);
    const frame = screen.getByTitle('Preview frame') as HTMLIFrameElement;
    fireEvent.load(frame);
    const input = frame.contentDocument!.createElement('input');
    frame.contentDocument!.body.append(input);
    input.focus();
    const tab = new frame.contentWindow!.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    fireEvent.keyDown(frame.contentDocument!, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument();
  });
});
