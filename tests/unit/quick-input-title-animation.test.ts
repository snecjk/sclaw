import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Quick input title animation', () => {
  it('uses the same overflow-scroll behavior as chat titles', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/quick-input/QuickInputListItem.tsx'),
      'utf8',
    );

    expect(source).toContain('SidebarSessionTitle');
    expect(source).toContain('sto-sidebar-session-title-trigger');
    expect(source).not.toContain('flex-1 truncate text-xs');
  });
});
