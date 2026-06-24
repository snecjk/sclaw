import { describe, expect, it } from 'vitest';
import { formatAppDisplayVersion } from '@/lib/format-app-display-version';

describe('formatAppDisplayVersion', () => {
  it('formats package version with suffix and zero-pads segments', () => {
    expect(formatAppDisplayVersion('2026.6.23-GA.1')).toBe('v2026.06.23');
  });

  it('formats version without suffix', () => {
    expect(formatAppDisplayVersion('2026.6.23')).toBe('v2026.06.23');
  });

  it('preserves already padded segments', () => {
    expect(formatAppDisplayVersion('2026.06.24')).toBe('v2026.06.24');
  });
});
