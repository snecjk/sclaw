import { describe, expect, it } from 'vitest';
import { isAuxiliaryWindowPath } from '@/lib/auxiliary-window-route';

describe('auxiliary window routes', () => {
  it('treats sprite, float-icon, and app-dev-ide as auxiliary', () => {
    expect(isAuxiliaryWindowPath('/sprite')).toBe(true);
    expect(isAuxiliaryWindowPath('/float-icon')).toBe(true);
    expect(isAuxiliaryWindowPath('/app-dev-ide/ws-1')).toBe(true);
    expect(isAuxiliaryWindowPath('/settings/mcp')).toBe(false);
    expect(isAuxiliaryWindowPath('/more-apps')).toBe(false);
  });
});
