import { describe, expect, it } from 'vitest';
import { isAppDevRestartIntent } from '@/lib/app-dev-restart-intent';

describe('isAppDevRestartIntent', () => {
  it.each([
    '重启',
    '重启预览',
    '重新启动应用',
    '请帮我重启一下预览服务',
    '麻烦重启开发服务！',
  ])('matches standalone restart command: %s', (text) => {
    expect(isAppDevRestartIntent(text)).toBe(true);
  });

  it.each([
    '重启后增加一个按钮',
    '应用为什么一直重启',
    '帮我修复预览服务',
    '停止预览',
  ])('does not swallow a development request: %s', (text) => {
    expect(isAppDevRestartIntent(text)).toBe(false);
  });
});
