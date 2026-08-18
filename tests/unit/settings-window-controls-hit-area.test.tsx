import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Settings Windows chrome hit area', () => {
  it('keeps the settings drag region away from the overlaid window controls', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/settings/SettingsShell.tsx'),
      'utf8',
    );

    expect(source).toContain("window.electron?.platform === 'win32'");
    expect(source).toContain('data-slot="settings-window-controls-hit-area"');
    expect(source).toContain('className="drag-region min-w-0 flex-1"');
    expect(source).toContain('className="no-drag pointer-events-none w-[128px] shrink-0"');
  });
});
