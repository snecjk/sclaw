/**
 * Sidebar layout variant — default provincial, opt-in full via VITE_STOCLAW_SIDEBAR_LAYOUT.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSidebarLayoutVariant, getSidebarVisibility } from '@/lib/sidebar-layout';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSidebarLayoutVariant', () => {
  it('returns provincial when env is not full', () => {
    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', '');
    expect(getSidebarLayoutVariant()).toBe('provincial');
    vi.unstubAllEnvs();

    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'provincial');
    expect(getSidebarLayoutVariant()).toBe('provincial');
    vi.unstubAllEnvs();

    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', '  province  ');
    expect(getSidebarLayoutVariant()).toBe('provincial');
  });

  it('returns full when env is full (case-insensitive)', () => {
    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'full');
    expect(getSidebarLayoutVariant()).toBe('full');

    vi.stubEnv('VITE_STOCLAW_SIDEBAR_LAYOUT', 'FULL');
    expect(getSidebarLayoutVariant()).toBe('full');
  });
});

describe('getSidebarVisibility', () => {
  it('hides chat, my data, workspace, conversation chrome for provincial; keeps bottom user card', () => {
    const v = getSidebarVisibility('provincial');
    expect(v).toEqual({
      primaryChat: false,
      primaryMyData: false,
      workspace: false,
      conversationChrome: false,
      userProfileCard: true,
    });
  });

  it('shows all modules for full', () => {
    const v = getSidebarVisibility('full');
    expect(v).toEqual({
      primaryChat: true,
      primaryMyData: true,
      workspace: true,
      conversationChrome: true,
      userProfileCard: true,
    });
  });
});
