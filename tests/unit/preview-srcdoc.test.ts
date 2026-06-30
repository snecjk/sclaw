import { describe, expect, it } from 'vitest';
import {
  documentBaseUrl,
  injectSrcDocBaseHref,
  injectSrcDocFetchBridge,
  preparePreviewSrcDoc,
  PREVIEW_HTTP_FETCH_TIMEOUT_MS,
} from '@/lib/preview-srcdoc';

describe('preview-srcdoc', () => {
  const sourceUrl = 'https://cdn.example.com/reports/总部结算对账分析.html';

  it('computes document base URL', () => {
    expect(documentBaseUrl(sourceUrl)).toBe('https://cdn.example.com/reports/');
  });

  it('injects base href into head', () => {
    const html = '<html><head><title>x</title></head><body>ok</body></html>';
    const out = injectSrcDocBaseHref(html, sourceUrl);
    expect(out).toContain('<base href="https://cdn.example.com/reports/">');
  });

  it('injects fetch bridge for artifact origin', () => {
    const html = '<html><head></head><body></body></html>';
    const out = injectSrcDocFetchBridge(html, sourceUrl);
    expect(out).toContain('preview-http-fetch');
    expect(out).toContain('https://cdn.example.com');
  });

  it('preparePreviewSrcDoc keeps body content', () => {
    const html = '<html><head></head><body><p>report</p></body></html>';
    const out = preparePreviewSrcDoc(html, sourceUrl);
    expect(out).toContain('<p>report</p>');
    expect(out).toContain('<base href="https://cdn.example.com/reports/">');
    expect(out).toContain('window.fetch');
  });

  it('fetch bridge includes timeout guard', () => {
    const html = '<html><head></head><body></body></html>';
    const out = injectSrcDocFetchBridge(html, sourceUrl);
    expect(out).toContain(`FETCH_TIMEOUT_MS = ${PREVIEW_HTTP_FETCH_TIMEOUT_MS}`);
    expect(out).toContain('Preview fetch timed out');
  });
});
