import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sidebar task title animation', () => {
  it('uses the shared session-title behavior for both task group variants', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'),
      'utf8',
    );

    expect(source.match(/<SidebarSessionTitle/g)).toHaveLength(2);
    expect(source.match(/sto-sidebar-session-title-trigger/g)).toHaveLength(2);
  });
});
