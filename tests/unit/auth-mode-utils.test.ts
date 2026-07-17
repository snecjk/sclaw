import { beforeEach, describe, expect, it } from 'vitest';
import {
  isHqDemoAsSite,
  resolveAiResourceIsSite,
  resolveAuthModeFromState,
  resolveSessionIsSite,
} from '../../shared/auth-mode-utils';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';

describe('auth-mode-utils', () => {
  beforeEach(() => {
    setSiteDepartmentTypes(['独立网点', '承包区']);
  });

  it('detects hq-demo-as-site when impersonationOrigin is set', () => {
    expect(isHqDemoAsSite({ code: 'hq001' })).toBe(true);
    expect(isHqDemoAsSite(null)).toBe(false);
  });

  it('resolveAuthModeFromState returns hq-demo-as-site when origin present', () => {
    const mode = resolveAuthModeFromState(
      { categoryCode: '独立网点' },
      { code: 'hq001' },
    );
    expect(mode).toBe('hq-demo-as-site');
  });

  it('resolveAuthModeFromState returns native-site for site login', () => {
    expect(resolveAuthModeFromState({ categoryCode: '独立网点' }, null)).toBe('native-site');
  });

  it('resolveAuthModeFromState returns native-hq for hq login', () => {
    expect(resolveAuthModeFromState({ categoryCode: '总部' }, null)).toBe('native-hq');
  });

  it('resolveAiResourceIsSite is false in demo-as-site even for site categoryCode', () => {
    expect(resolveAiResourceIsSite('独立网点', { code: 'hq' })).toBe(false);
  });

  it('resolveSessionIsSite follows categoryCode', () => {
    expect(resolveSessionIsSite('独立网点')).toBe(true);
    expect(resolveSessionIsSite('总部')).toBe(false);
  });
});
