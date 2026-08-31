import { afterEach, describe, expect, it, vi } from 'vitest';

const PROD_PREVIEW =
  'https://page.sto.cn/ux/sto-finance-bi-preview/index.html#/report-square';
const PROD_FRONT = 'https://page.sto.cn/ux/sto-finance-bi-front/index.html';

describe('sto-finance-bi-web-url', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('always uses production page.sto.cn', async () => {
    vi.stubEnv('VITE_APP_ENV', 'development');
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(mod.getStoFinanceBiPageOrigin()).toBe('https://page.sto.cn');
    expect(mod.getStoFinanceBiReportSquareUrl()).toBe(PROD_PREVIEW);
    expect(mod.getStoFinanceBiLoginUrl()).toBe(PROD_FRONT);
  });

  it('extracts skip-login code from ticket url', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(
      mod.extractStoFinanceBiSkipLoginCode(
        'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?code=ticket-code-123',
      ),
    ).toBe('ticket-code-123');
  });

  it('builds front login url from mc front ticket', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(
      mod.buildStoFinanceBiEmbedUrl(
        'https://page.sto.cn/ux/sto-finance-bi-front/index.html#/login?code=ticket-code-123',
      ),
    ).toBe(
      `${PROD_FRONT}?code=ticket-code-123&returnUrl=${encodeURIComponent(PROD_PREVIEW)}#/login`,
    );
  });

  it('builds front login url with code from sso skip-login ticket', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(
      mod.buildStoFinanceBiEmbedUrl(
        'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?code=ticket-code-123&systemCode=sto-finance-bi',
      ),
    ).toBe(
      `${PROD_FRONT}?code=ticket-code-123&returnUrl=${encodeURIComponent(PROD_PREVIEW)}#/login`,
    );
  });

  it('falls back to hash redirect login when ticket has no code', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(
      mod.buildStoFinanceBiEmbedUrl(
        'https://page.sto.cn/sto-base-service/sto-sso-web/#/main?systemCode=sto-finance-bi',
      ),
    ).toBe(
      `${PROD_FRONT}#/login?redirect=${encodeURIComponent(PROD_PREVIEW)}`,
    );
  });

  it('normalizes page-test ticket host to production', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(
      mod.alignFinanceBiSkipLoginUrl(
        'https://page-test.sto.cn/ux/sto-finance-bi-front/index.html#/login?code=abc',
      ),
    ).toBe(
      'https://page.sto.cn/ux/sto-finance-bi-front/index.html#/login?code=abc',
    );
  });

  it('exports sto-finance-bi system code', async () => {
    const mod = await import('@/lib/sto-finance-bi-web-url');
    expect(mod.STO_FINANCE_BI_SYSTEM_CODE).toBe('sto-finance-bi');
  });
});
