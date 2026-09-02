import { describe, expect, it } from 'vitest';
import { appDevSetupHeadline, appDevSetupSteps } from '../../src/lib/app-dev-pipeline';

describe('appDevSetupSteps', () => {
  it('marks tools active while detecting snpm', () => {
    const steps = appDevSetupSteps('checking-snpm', '本机已安装 snpm');
    expect(steps.map((s) => s.state)).toEqual(['active', 'pending', 'pending']);
    expect(steps[0].hint).toBe('本机已安装 snpm');
    expect(steps[1].title).toBe('执行依赖');
    expect(steps[2].title).toBe('执行启动');
  });

  it('marks deps active while installing', () => {
    expect(appDevSetupSteps('installing').map((s) => s.state)).toEqual(['done', 'active', 'pending']);
  });

  it('marks start active while starting', () => {
    expect(appDevSetupSteps('starting').map((s) => s.state)).toEqual(['done', 'done', 'active']);
  });
});

describe('appDevSetupHeadline', () => {
  it('uses user-facing verbs for deps and start', () => {
    expect(appDevSetupHeadline('installing')).toBe('正在执行依赖…');
    expect(appDevSetupHeadline('starting')).toBe('正在执行启动…');
    expect(appDevSetupHeadline('checking-snpm')).toBe('正在检测 snpm…');
  });
});
