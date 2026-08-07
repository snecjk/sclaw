import { describe, expect, it } from 'vitest';
import {
  proxiesFromContract,
  resolveApiUrl,
} from '../../resources/app-templates/react-a2ui-template/src/lib/resolve-api-url';

const proxies = proxiesFromContract({
  version: 'v1',
  proxies: [
    { key: 'qianji-test-sto-cn', target: 'https://qianji-test.sto.cn', changeOrigin: true },
  ],
});

describe('resolveApiUrl', () => {
  it('keeps /proxy paths in development', () => {
    expect(
      resolveApiUrl('/proxy/qianji-test-sto-cn/sto-customer-manager-web/cli/api', {
        isDev: true,
        proxies,
      }),
    ).toBe('/proxy/qianji-test-sto-cn/sto-customer-manager-web/cli/api');
  });

  it('rewrites /proxy paths to absolute target in production', () => {
    expect(
      resolveApiUrl('/proxy/qianji-test-sto-cn/sto-customer-manager-web/cli/kams/fin/api/sdd/board/sdd/type', {
        isDev: false,
        proxies,
      }),
    ).toBe(
      'https://qianji-test.sto.cn/sto-customer-manager-web/cli/kams/fin/api/sdd/board/sdd/type',
    );
  });

  it('preserves query string when rewriting', () => {
    expect(
      resolveApiUrl('/proxy/qianji-test-sto-cn/api/x?a=1', {
        isDev: false,
        proxies,
      }),
    ).toBe('https://qianji-test.sto.cn/api/x?a=1');
  });

  it('leaves absolute urls untouched', () => {
    expect(
      resolveApiUrl('https://qianji-test.sto.cn/api/x', {
        isDev: false,
        proxies,
      }),
    ).toBe('https://qianji-test.sto.cn/api/x');
  });
});
