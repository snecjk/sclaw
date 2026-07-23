import { describe, expect, it } from 'vitest';
import {
  isSidebarPrimaryNavItemVisible,
  isSidebarPrimaryNavRoute,
} from '@/lib/sidebar-primary-nav';

describe('isSidebarPrimaryNavRoute', () => {
  it('matches primary nav routes', () => {
    expect(isSidebarPrimaryNavRoute('/')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/my-tasks')).toBe(true);
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
    expect(isSidebarPrimaryNavRoute('/scheduled-tasks')).toBe(false);
    expect(isSidebarPrimaryNavRoute('/cron')).toBe(false);
  });
});

describe('isSidebarPrimaryNavItemVisible', () => {
  const nonSiteOptions = {
    primaryMyData: true,
    siteDepartmentTypesLoaded: false,
    isSite: false,
    isProduction: false,
  };

  it('keeps More Apps visible without site identity or site configuration', () => {
    expect(isSidebarPrimaryNavItemVisible('/more-apps', nonSiteOptions)).toBe(true);
  });

  it('keeps site-only navigation restricted', () => {
    expect(isSidebarPrimaryNavItemVisible('/data-center', nonSiteOptions)).toBe(false);
  });
});
