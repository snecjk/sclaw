/**
 * Convert Markdown to plain text for channels that do not render Markdown (e.g. DingTalk defaultMsg).
 * Preserves paragraph and list line breaks; strips formatting markers.
 */
const URL_TOKEN_PREFIX = '\uE000URL';

function protectHttpUrls(text: string, store: string[]): string {
  return text.replace(/https?:\/\/[^\s<>\][\uE000]+/g, (url) => {
    const index = store.length;
    store.push(url);
    return `${URL_TOKEN_PREFIX}${index}\uE001`;
  });
}

function restoreHttpUrls(text: string, store: string[]): string {
  return text.replace(/\uE000URL(\d+)\uE001/g, (_, index: string) => store[Number(index)] ?? '');
}

export function markdownToPlainText(markdown: string): string {
  if (!markdown) return '';

  const urlStore: string[] = [];
  let text = markdown.replace(/\r\n/g, '\n');

  // Fenced code blocks — keep content, drop fence language tag line semantics
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => code.replace(/\s+$/, ''));

  // Inline code
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) => {
    const label = alt.trim() || '图片';
    const href = url.trim();
    return href ? `${label}: ${href}` : label;
  });

  // Links [label](url) — keep full URL (query string may contain special chars)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
    const name = label.trim();
    const href = url.trim();
    if (!href) return name;
    if (!name || name === href) return href;
    return `${name}: ${href}`;
  });

  // Protect http(s) URLs before inline markdown stripping (underscores in OSS signed URLs are not italic)
  text = protectHttpUrls(text, urlStore);

  // ATX headings
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Bold / italic (order: bold before italic)
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g, '$1');
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/_([^_\n]+)_/g, '$1');

  // Strikethrough
  text = text.replace(/~~([^~\n]+)~~/g, '$1');

  // Blockquote prefix
  text = text.replace(/^>\s?/gm, '');

  // Horizontal rules — blank line
  text = text.replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, '');

  text = restoreHttpUrls(text, urlStore);

  // Trim trailing spaces per line; keep intentional blank lines
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n');

  // Collapse 3+ consecutive blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
