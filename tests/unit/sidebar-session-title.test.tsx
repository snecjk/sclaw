import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarSessionTitle } from '@/components/layout/sidebar-session-title';

type ResizeCallback = ResizeObserverCallback;

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeCallback;

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  ResizeObserverStub.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SidebarSessionTitle', () => {
  it('keeps a fitting title static', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 80,
      height: 18,
      top: 0,
      right: 80,
      bottom: 18,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    render(<SidebarSessionTitle label="Short title" />);

    const viewport = screen.getByText('Short title').parentElement;
    expect(viewport).not.toHaveAttribute('data-overflow');
    expect(screen.getAllByText('Short title')).toHaveLength(1);
  });

  it('measures an overflowing title for a single scroll to the end', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 360,
      height: 18,
      top: 0,
      right: 360,
      bottom: 18,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    render(<SidebarSessionTitle label="A title that does not fit" />);

    const title = screen.getByText('A title that does not fit');
    const viewport = title.closest('[data-overflow]');
    const track = title.parentElement;
    expect(viewport).toHaveAttribute('data-overflow', 'true');
    expect(screen.getAllByText('A title that does not fit')).toHaveLength(1);
    expect(track?.style.getPropertyValue('--sto-sidebar-title-distance')).toBe('240px');
    expect(track?.style.getPropertyValue('--sto-sidebar-title-duration')).toBe('40s');

    act(() => {
      ResizeObserverStub.instances[0].callback([], ResizeObserverStub.instances[0] as unknown as ResizeObserver);
    });
  });
});
