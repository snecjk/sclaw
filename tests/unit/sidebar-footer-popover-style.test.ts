import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sidebarFooterPopoverBodyClass,
  sidebarFooterPopoverContentClass,
} from '@/lib/surfaces';

describe('Sidebar footer popover styling', () => {
  it('defines the shared compact panel geometry', () => {
    expect(sidebarFooterPopoverContentClass).toContain('w-[260px]');
    expect(sidebarFooterPopoverContentClass).toContain('rounded-[12px]');
    expect(sidebarFooterPopoverContentClass).toContain('sto-shadow-dropdown-strong');
    expect(sidebarFooterPopoverBodyClass).toContain('p-3');
  });

  it.each([
    'src/components/layout/SidebarMobileConnectTooltip.tsx',
    'src/components/layout/SidebarSupportQrTooltip.tsx',
  ])('%s consumes the shared panel styles', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('sidebarFooterPopoverContentClass');
    expect(source).toContain('sidebarFooterPopoverBodyClass');
  });
});
