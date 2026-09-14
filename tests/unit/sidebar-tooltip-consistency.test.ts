import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sidebarTooltipArrowClass,
  sidebarTooltipContentClass,
} from '@/lib/surfaces';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Sidebar tooltip consistency', () => {
  it('uses the new-project tooltip appearance as the shared sidebar style', () => {
    const source = readSource('src/components/layout/sidebar-tooltip.tsx');

    expect(source).toContain('sidebarTooltipContentClass');
    expect(source).toContain('sidebarTooltipArrowClass');
    expect(sidebarTooltipContentClass).toContain('sto-overlay--content-tooltip');
    expect(sidebarTooltipContentClass).toContain('border-none');
    expect(sidebarTooltipContentClass).toContain('bg-[#1D2129]');
    expect(sidebarTooltipContentClass).toContain('rounded-lg');
    expect(sidebarTooltipArrowClass).toContain('fill-[#1D2129]');
  });

  it.each([
    ['src/components/layout/sidebar-header-toggle.tsx', 'title={label}'],
    ['src/components/layout/sidebar-project-session-row.tsx', 'title={label}'],
    ['src/components/layout/sidebar-recent-session-row.tsx', 'title={label}'],
    ['src/components/layout/sidebar-recent-group-row.tsx', 'title={group.name}'],
    ['src/components/layout/sidebar-projects-section.tsx', 'title={`${workspace.name}'],
    ['src/components/layout/sidebar-brand-header.tsx', 'title={displayVersion}'],
    ['src/components/layout/SidebarMobileConnectTooltip.tsx', "title={t('hub.mobile.title')}"],
    ['src/components/layout/SidebarSupportQrTooltip.tsx', "title={t('sidebar.supportGroup.helpAria')}"],
  ])('%s uses the shared tooltip instead of a native title bubble', (path, nativeTitle) => {
    const source = readSource(path);

    expect(source).toContain('SidebarTooltip');
    expect(source).not.toContain(nativeTitle);
  });

  it('keeps only dialog title props in the sidebar shell', () => {
    const source = readSource('src/components/layout/Sidebar.tsx');

    expect(source).toContain('SidebarTooltip');
    expect(source.match(/\btitle=\{/g)).toHaveLength(1);
    expect(source).toContain("title={t('auth:logout.confirmTitle')}");
  });
});
