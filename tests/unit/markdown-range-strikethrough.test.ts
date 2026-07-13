import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
}

const hyphenRange =
  '停发：7（连续多少天没有发货）；降量：20-50（降量比例区间(含)）；严重降量：50（降量比例达到该值及以上）；连续降量：2（连续多少天降量达到上方区间）；增量：20-50（增量比例区间(含)）；突增：50（增量比例达到该值及以上）；新客停发：3（新客连续多少天未发货）';

const tildeRange = hyphenRange.replace(/20-50/g, '20~50');

describe('range notation vs GFM strikethrough', () => {
  it('hyphen ranges (20-50) do not produce <del>', () => {
    const html = renderMarkdown(hyphenRange);
    expect(html).not.toContain('<del>');
    expect(html).toContain('20-50');
  });

  it('tilde ranges (20~50) can produce <del> when paired across the paragraph', () => {
    const html = renderMarkdown(tildeRange);
    expect(html).toContain('<del>');
  });

  it('explicit ~~ still produces strikethrough', () => {
    const html = renderMarkdown('~~deleted~~');
    expect(html).toContain('<del>deleted</del>');
  });
});
