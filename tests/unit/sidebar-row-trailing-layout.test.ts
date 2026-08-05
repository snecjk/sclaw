import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sidebarSingleActionRowPaddingClass,
  sidebarSingleActionTrailingSlotClass,
} from '@/lib/surfaces';

describe('Sidebar single-action trailing geometry', () => {
  it('uses one flush-right 28px slot without extra title gap', () => {
    expect(sidebarSingleActionRowPaddingClass).toBe('pr-7');
    expect(sidebarSingleActionTrailingSlotClass).toContain('right-0');
    expect(sidebarSingleActionTrailingSlotClass).toContain('w-7');
    expect(sidebarSingleActionTrailingSlotClass).not.toContain('right-[10px]');
    expect(sidebarSingleActionTrailingSlotClass).not.toContain('w-12');
  });

  it('shares the geometry across recent, project-session, and task-subitem rows', () => {
    const sources = [
      'src/components/layout/sidebar-recent-session-row.tsx',
      'src/components/layout/sidebar-recent-session-row-trailing.tsx',
      'src/components/layout/sidebar-project-session-row.tsx',
      'src/components/layout/sidebar-project-session-row-trailing.tsx',
      'src/components/layout/sidebar-task-subitem-delete-trailing.tsx',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'));

    expect(sources[0]).toContain('sidebarSingleActionRowPaddingClass');
    expect(sources[1]).toContain('sidebarSingleActionTrailingSlotClass');
    expect(sources[2]).toContain('sidebarSingleActionRowPaddingClass');
    expect(sources[3]).toContain('sidebarSingleActionTrailingSlotClass');
    expect(sources[4]).toContain('sidebarSingleActionTrailingSlotClass');

    for (const source of sources) {
      expect(source).not.toContain('right-[10px]');
      expect(source).not.toContain('pr-12');
    }
  });
});
