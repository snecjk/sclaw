import { describe, expect, it } from 'vitest';
import {
  resolveSidebarAccountEmployeeId,
  resolveSidebarAccountFooterMode,
  resolveSidebarAccountName,
  shouldRenderAccountGearIcon,
} from '@/lib/sidebar-account-footer';
import {
  sidebarAccountHelpTriggerClass,
  sidebarAccountHotzoneTriggerClass,
} from '@/lib/surfaces';

describe('resolveSidebarAccountFooterMode', () => {
  it('uses expanded hotzone when profile card is shown and sidebar is open', () => {
    expect(
      resolveSidebarAccountFooterMode({
        userProfileCard: true,
        sidebarCollapsed: false,
      }),
    ).toBe('expanded-hotzone');
  });

  it('keeps collapsed avatar entry when profile card is shown and sidebar is collapsed', () => {
    expect(
      resolveSidebarAccountFooterMode({
        userProfileCard: true,
        sidebarCollapsed: true,
      }),
    ).toBe('collapsed-avatar');
  });

  it('keeps compact gear entry when profile card is hidden', () => {
    expect(
      resolveSidebarAccountFooterMode({
        userProfileCard: false,
        sidebarCollapsed: false,
      }),
    ).toBe('compact-gear');
  });
});

describe('resolveSidebarAccountName', () => {
  it('prefers realName over userName', () => {
    expect(resolveSidebarAccountName({
      realName: '安谱卓阳',
      userName: '10001',
    })).toBe('安谱卓阳');
  });

  it('falls back to userName when realName is empty', () => {
    expect(resolveSidebarAccountName({
      realName: '  ',
      userName: '10001',
    })).toBe('10001');
  });

  it('returns empty string without a user', () => {
    expect(resolveSidebarAccountName(null)).toBe('');
  });
});

describe('resolveSidebarAccountEmployeeId', () => {
  it('prefers 梧桐工号 code next to the name', () => {
    expect(resolveSidebarAccountEmployeeId({
      realName: '安谱卓阳',
      userName: '10001',
      empCode: 'E2',
      code: 'W3',
    })).toBe('W3');
  });

  it('falls back to empCode then userName', () => {
    expect(resolveSidebarAccountEmployeeId({
      realName: '安谱卓阳',
      userName: '10001',
      empCode: 'E2',
      code: '',
    })).toBe('E2');
    expect(resolveSidebarAccountEmployeeId({
      realName: '安谱卓阳',
      userName: '10001',
      empCode: '',
      code: '',
    })).toBe('10001');
  });

  it('does not repeat the name when it already is the 工号', () => {
    expect(resolveSidebarAccountEmployeeId({
      realName: '10001',
      userName: '10001',
      empCode: '',
      code: '10001',
    })).toBe('');
  });

  it('returns empty string when no employee id exists', () => {
    expect(resolveSidebarAccountEmployeeId({
      realName: '安谱卓阳',
      userName: '',
      empCode: '',
      code: '',
    })).toBe('');
  });
});

describe('shouldRenderAccountGearIcon', () => {
  it('never renders gear for expanded hotzone', () => {
    expect(shouldRenderAccountGearIcon('expanded-hotzone')).toBe(false);
  });

  it('never renders gear for collapsed avatar entry', () => {
    expect(shouldRenderAccountGearIcon('collapsed-avatar')).toBe(false);
  });

  it('renders gear only for compact gear entry', () => {
    expect(shouldRenderAccountGearIcon('compact-gear')).toBe(true);
  });
});

describe('sidebar account hotzone surfaces', () => {
  it('matches MasterGo hover/open radius and fill tokens', () => {
    expect(sidebarAccountHotzoneTriggerClass).toContain('rounded-[4px]');
    expect(sidebarAccountHotzoneTriggerClass).toContain('hover:bg-black/10');
    expect(sidebarAccountHotzoneTriggerClass).toContain('data-[state=open]:bg-black/10');
    expect(sidebarAccountHotzoneTriggerClass).toContain('dark:hover:bg-white/10');
    expect(sidebarAccountHotzoneTriggerClass).toContain('focus-visible:ring-2');
  });

  it('sizes help trigger to 32px with independent hotzone', () => {
    expect(sidebarAccountHelpTriggerClass).toContain('h-8');
    expect(sidebarAccountHelpTriggerClass).toContain('w-8');
    expect(sidebarAccountHelpTriggerClass).toContain('p-1.5');
  });
});
