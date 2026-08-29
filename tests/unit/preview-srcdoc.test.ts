import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  documentBaseUrl,
  injectSrcDocBaseHref,
  injectSrcDocFetchBridge,
  prepareInlinePreviewSrcDoc,
  preparePreviewSrcDoc,
  PREVIEW_HTTP_FETCH_TIMEOUT_MS,
} from '@/lib/preview-srcdoc';

const previewSource = readFileSync(
  resolve(process.cwd(), 'src/lib/preview-srcdoc.ts'),
  'utf8',
);

describe('preview-srcdoc', () => {
  const sourceUrl = 'https://cdn.example.com/reports/总部结算对账分析.html';

  it('reuses canonical theme tokens without copying the renderer palette', () => {
    expect(previewSource).toContain('tokens.css?raw');
    expect(previewSource).not.toMatch(/--background:\s*#[\da-f]{3,8}/i);
  });

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
    const out = preparePreviewSrcDoc(html, sourceUrl, { appearance: 'light', mode: 'adaptive' });
    expect(out).toContain('<p>report</p>');
    expect(out).toContain('<base href="https://cdn.example.com/reports/">');
    expect(out).toContain('window.fetch');
  });

  it('injects adaptive dark variables and table compatibility styles', () => {
    const out = preparePreviewSrcDoc(
      '<html><head></head><body><table><tr><td>28</td></tr></table></body></html>',
      sourceUrl,
      { appearance: 'dark', mode: 'adaptive' },
    );
    expect(out).toContain('data-sto-theme="dark"');
    expect(out).toContain('data-sto-preview-mode="adaptive"');
    expect(out).toContain('background:var(--sto-canvas) !important');
    expect(out).not.toContain('--sto-preview-surface:');
    expect(out).toMatch(/table[\s\S]*th[\s\S]*td/);
    expect(out).toContain('sto:appearance-change');
  });

  it('does not add adaptive element overrides in fidelity mode', () => {
    const out = prepareInlinePreviewSrcDoc('<html><head></head><body>paper</body></html>', {
      appearance: 'dark',
      mode: 'fidelity',
    });
    expect(out).toContain('data-sto-preview-mode="fidelity"');
    expect(out).not.toContain('html[data-sto-preview-mode="adaptive"');
  });

  it('accepts appearance messages only from the parent with the expected payload', () => {
    const out = prepareInlinePreviewSrcDoc('<html><head></head><body>paper</body></html>', {
      appearance: 'light',
      mode: 'adaptive',
    });
    const parsed = new DOMParser().parseFromString(out, 'text/html');
    const script = parsed.querySelector('script[data-sto-preview-theme]')?.textContent;
    expect(script).toBeTruthy();

    const parentWindow = {};
    let onMessage: ((event: MessageEvent) => void) | undefined;
    const previewWindow = {
      parent: parentWindow,
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') onMessage = listener;
      },
    };
    const root = { dataset: { stoTheme: 'light' }, style: { colorScheme: 'light' } };
    const previewDocument = { documentElement: root };
    new Function('window', 'document', script ?? '')(previewWindow, previewDocument);

    onMessage?.({ source: {}, data: { type: 'sto:appearance-change', appearance: 'dark' } } as MessageEvent);
    onMessage?.({ source: parentWindow, data: { type: 'unexpected', appearance: 'dark' } } as MessageEvent);
    onMessage?.({ source: parentWindow, data: { type: 'sto:appearance-change', appearance: 'system' } } as MessageEvent);
    expect(root).toEqual({ dataset: { stoTheme: 'light' }, style: { colorScheme: 'light' } });

    onMessage?.({ source: parentWindow, data: { type: 'sto:appearance-change', appearance: 'dark' } } as MessageEvent);
    expect(root).toEqual({ dataset: { stoTheme: 'dark' }, style: { colorScheme: 'dark' } });
  });

  it('fetch bridge includes timeout guard', () => {
    const html = '<html><head></head><body></body></html>';
    const out = injectSrcDocFetchBridge(html, sourceUrl);
    expect(out).toContain(`FETCH_TIMEOUT_MS = ${PREVIEW_HTTP_FETCH_TIMEOUT_MS}`);
    expect(out).toContain('Preview fetch timed out');
  });
});
