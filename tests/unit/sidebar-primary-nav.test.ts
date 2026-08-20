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
    expect(isSidebarPrimaryNavRoute('/data-center')).toBe(true);
    expect(isSidebarPrimaryNavRoute('/learning-center')).toBe(true);
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
  const baseOptions = {
    primaryMyData: true,
    learningCenterVisible: false,
    isProduction: false,
  };

  it('keeps More Apps visible without site identity or site configuration', () => {
    expect(isSidebarPrimaryNavItemVisible('/more-apps', baseOptions)).toBe(true);
  });

  it('keeps Data Center visible without site identity or site configuration', () => {
    expect(isSidebarPrimaryNavItemVisible('/data-center', baseOptions)).toBe(true);
  });

  it('hides Learning Center without a visible learning domain', () => {
    expect(isSidebarPrimaryNavItemVisible('/learning-center', baseOptions)).toBe(false);
  });

  it('shows Learning Center when the backend returns a visible learning domain', () => {
    expect(isSidebarPrimaryNavItemVisible('/learning-center', {
      ...baseOptions,
      learningCenterVisible: true,
    })).toBe(true);
  });
});
