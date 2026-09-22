import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  stoAppShellGridProvincialClass,
  stoAppShellSidebarGapClass,
  stoWorkspaceWrapClass,
} from '@/lib/surfaces';

describe('app shell layout surfaces', () => {
  it('uses three columns with 8px L0 gap track and explicit minmax row', () => {
    expect(stoAppShellGridProvincialClass).toContain(
      'grid-cols-[var(--sto-sidebar-effective-w)_var(--sto-shell-card-gap)_minmax(0,1fr)]',
    );
    expect(stoAppShellGridProvincialClass).toContain('grid-rows-[minmax(0,1fr)]');
    expect(stoAppShellGridProvincialClass).toContain('sto-app-shell-grid');
    expect(stoAppShellSidebarGapClass).toContain('sto-sidebar-gap');
  });

  it('workspace wrap is a height-constrained grid item with frame padding', () => {
    expect(stoWorkspaceWrapClass).toContain('min-h-0');
    expect(stoWorkspaceWrapClass).toContain('overflow-hidden');
    expect(stoWorkspaceWrapClass).toContain('pt-[var(--sto-shell-card-gap)]');
    expect(stoWorkspaceWrapClass).toContain('pr-[var(--sto-shell-card-gap)]');
    expect(stoWorkspaceWrapClass).toContain('pb-[var(--sto-shell-card-gap)]');
    expect(stoWorkspaceWrapClass).not.toContain('p-0');
  });

  it('Sidebar aside keeps min-h-0 overflow-hidden for scroll ownership', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'),
      'utf8',
    );
    expect(src).toMatch(/flex h-full min-h-0 shrink-0 flex-col overflow-hidden/);
  });

  it('MainLayout provincial branch uses grid and does not use collapsed body p-2', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/layout/MainLayout.tsx'),
      'utf8',
    );
    expect(src).toContain('stoAppShellGridProvincialClass');
    expect(src).toContain('stoWorkspaceWrapClass');
    expect(src).toContain('stoAppShellSidebarGapClass');
    expect(src).toContain('--sto-sidebar-effective-w');
    expect(src).not.toContain('stoAppShellBodyProvincialClass(sidebarCollapsed)');
    expect(src).not.toContain('stoMainCardWrapClass(sidebarCollapsed)');
  });

  it('data-manage create embed uses a flush fullscreen shell without workspace frame', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/layout/MainLayout.tsx'),
      'utf8',
    );
    expect(src).toContain('data-page-embed="true"');
    expect(src).toContain('data-sidebar-collapsed="true"');
    expect(src).toContain('onDataManageCreate');
    expect(src).toContain('stoMainCardBodyEmbedClass');
  });

  it('App toast consumer has no hard-coded 72/260 branch', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(src).toContain('AppShellLayoutProvider');
    expect(src).toContain('computeToastLayoutOffsetPx');
    expect(src).toContain("pointerEvents: 'auto'");
    expect(src).not.toContain('sidebarCollapsed ? 72 : 260');
    expect(src).not.toContain('collapsed ? 72 : 260');
  });

  it('Sidebar no longer rewrites user preference for workflow context', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'),
      'utf8',
    );
    expect(src).toContain('useAppShellLayout');
    expect(src).not.toContain('sidebarExpandedBeforeWorkflowRef');
    expect(src).not.toContain('workflowEditorActive');
  });
});
