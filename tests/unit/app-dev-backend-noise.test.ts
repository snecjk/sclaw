import { describe, expect, it } from 'vitest';
import { isBackendRepairWorthyLine } from '../../shared/app-dev-backend-noise';

describe('isBackendRepairWorthyLine', () => {
  it('ignores tsx watch / listen noise', () => {
    expect(isBackendRepairWorthyLine('[tsx] Restarting...')).toBe(false);
    expect(isBackendRepairWorthyLine('[app-backend] listening on http://127.0.0.1:8787')).toBe(false);
    expect(isBackendRepairWorthyLine('[migrate] ok')).toBe(false);
  });

  it('flags sqlite / uncaught / 5xx', () => {
    expect(isBackendRepairWorthyLine('SQLITE_ERROR: no such table')).toBe(true);
    expect(isBackendRepairWorthyLine('Error: uncaught exception')).toBe(true);
    expect(isBackendRepairWorthyLine('HTTP 500 Internal Server Error')).toBe(true);
  });
});
