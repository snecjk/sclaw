import { describe, expect, it } from 'vitest';
import { isSidebarPrimaryNavRoute } from '@/lib/sidebar-primary-nav';

describe('isSidebarPrimaryNavRoute', () => {
  it('matches primary nav routes', () => {
    expect(isSidebarPrimaryNavRoute('/')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/scheduled-tasks')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/my-tasks')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/cron')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/skills')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/workflow')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/workflow/edit/wf_abc')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/more-apps')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/models')).toBe(true);
  });

  it('does not match workspace or task routes', () => {
    expect(isSidebarPrimaryNavRoute('/agents')).toBe(false);
    expect(isSidebarPrimaryNavRoute('/channels')).toBe(false);
    expect(isSidebarPrimaryNavRoute('/subscriptions')).toBe(false);
    expect(isSidebarPrimaryNavRoute('/tasks/task_abc')).toBe(false);
    expect(isSidebarPrimaryNavRoute('/settings')).toBe(false);
  });
});
