import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeController } from '@/components/theme/ThemeController';
import {
  applyResolvedAppearance,
  postResolvedAppearance,
  STO_APPEARANCE_MESSAGE_TYPE,
} from '@/components/theme/appearance-context';
import { SidebarBrandHeader } from '@/components/layout/sidebar-brand-header';
import { useSettingsStore } from '@/stores/settings';

const hostEventState = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    eventName: string;
    handler: (payload: unknown) => void;
  }>,
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (eventName: string, handler: (payload: unknown) => void) => {
    const subscription = { eventName, handler };
    hostEventState.subscriptions.push(subscription);
    return () => {
      hostEventState.subscriptions = hostEventState.subscriptions.filter(
        (candidate) => candidate !== subscription,
      );
    };
  },
}));

function appearanceSubscription(): (payload: unknown) => void {
  const subscription = hostEventState.subscriptions.find(
    ({ eventName }) => eventName === 'sto:appearance-state',
  );
  expect(subscription).toBeDefined();
  return subscription!.handler;
}

describe('theme controller appearance helpers', () => {
  beforeEach(() => {
    hostEventState.subscriptions = [];
    useSettingsStore.setState({ theme: 'light' });
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('applies class, data attribute, and color scheme together', () => {
    const root = document.documentElement;
    applyResolvedAppearance(root, 'dark');

    expect(root).toHaveClass('dark');
    expect(root).not.toHaveClass('light');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('uses an SClaw-owned message name', () => {
    expect(STO_APPEARANCE_MESSAGE_TYPE).toBe('sto:appearance-change');
  });

  it('posts the resolved appearance to a preview window', () => {
    const postMessage = vi.fn();
    postResolvedAppearance({ postMessage } as unknown as Window, 'light');

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'sto:appearance-change', appearance: 'light' },
      '*',
    );
  });

  it('shares the resolved appearance with the sidebar without another media subscription', () => {
    const matchMedia = vi.mocked(window.matchMedia);
    matchMedia.mockClear();

    render(
      <ThemeController>
        <SidebarBrandHeader
          layoutVariant="full"
          onCollapse={vi.fn()}
          collapseLabel="Collapse sidebar"
          expandLabel="Expand sidebar"
        />
      </ThemeController>,
    );

    expect(screen.getByRole('img', { name: 'SClaw' })).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledTimes(2);
  });

  it('synchronizes a stale secondary renderer across explicit and system transitions', async () => {
    let systemDark = false;
    const mediaListeners = new Set<() => void>();
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      get matches() {
        return systemDark;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type, listener) => mediaListeners.add(listener as () => void),
      removeEventListener: (_type, listener) => mediaListeners.delete(listener as () => void),
      dispatchEvent: vi.fn(),
    }));

    const frame = document.createElement('iframe');
    frame.dataset.stoThemeSync = 'true';
    document.body.append(frame);
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});

    render(<ThemeController />);
    await waitFor(() => expect(document.documentElement).toHaveClass('light'));
    postMessage.mockClear();
    const persistPreference = vi.spyOn(useSettingsStore.getState(), 'setTheme');

    act(() => appearanceSubscription()({ preference: 'dark', appearance: 'light' }));
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(postMessage).not.toHaveBeenCalled();

    act(() => appearanceSubscription()({ preference: 'dark', appearance: 'dark' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'sto:appearance-change', appearance: 'dark' },
      '*',
    );

    postMessage.mockClear();
    act(() => appearanceSubscription()({ preference: 'light', appearance: 'light' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('light'));
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(postMessage).toHaveBeenCalledTimes(1);

    postMessage.mockClear();
    act(() => appearanceSubscription()({ preference: 'system', appearance: 'light' }));
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      systemDark = true;
      mediaListeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(postMessage).toHaveBeenCalledTimes(1);

    postMessage.mockClear();
    act(() => appearanceSubscription()({ preference: 'dark', appearance: 'dark' }));
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(postMessage).not.toHaveBeenCalled();

    act(() => appearanceSubscription()({ preference: 'system', appearance: 'dark' }));
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(postMessage).not.toHaveBeenCalled();
    expect(persistPreference).not.toHaveBeenCalled();

    persistPreference.mockRestore();
    frame.remove();
  });
});
