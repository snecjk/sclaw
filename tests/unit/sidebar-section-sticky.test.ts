import { describe, expect, it } from 'vitest';
import {
  sidebarSectionStickyTopProjectClass,
  sidebarSectionStickyTopRecentClass,
  sidebarSectionStickyTopTaskClass,
} from '@/lib/surfaces';

describe('sidebar section sticky tops', () => {
  it('stacks project / task / recent at 0 / 1× / 2× sticky height', () => {
    expect(sidebarSectionStickyTopProjectClass).toContain('top-0');
    expect(sidebarSectionStickyTopTaskClass).toContain(
      'top-[var(--sto-sidebar-section-sticky-h)]',
    );
    expect(sidebarSectionStickyTopRecentClass).toContain(
      'top-[calc(2*var(--sto-sidebar-section-sticky-h))]',
    );
  });
});
