/** StoClaw IM rich-text Custom payload (OpenIM contentType=110). */

export const IM_RICH_BIZ_TYPE = 'im_rich_v1' as const;
export const IM_RICH_VERSION = 1 as const;

export interface ImRichPayload {
  bizType: typeof IM_RICH_BIZ_TYPE;
  version: typeof IM_RICH_VERSION;
  html: string;
  plainText: string;
}

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
  'UL', 'OL', 'LI', 'A', 'IMG', 'HR', 'PRE', 'CODE', 'BLOCKQUOTE',
  'H1', 'H2', 'H3',
]);

const ALLOWED_ATTR: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
  IMG: new Set(['src', 'alt', 'width', 'height']),
  SPAN: new Set(['style']),
  FONT: new Set(['color']),
};

const SAFE_URL = /^(https?:|mailto:|blob:|data:image\/)/i;
const SAFE_HTTP_ONLY = /^https?:/i;

function isSafeHref(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  return SAFE_URL.test(trimmed) || trimmed.startsWith('#');
}

function isSafeImgSrc(value: string, { allowLocal }: { allowLocal: boolean }): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  if (SAFE_HTTP_ONLY.test(trimmed)) return true;
  if (allowLocal && (trimmed.startsWith('blob:') || trimmed.startsWith('data:image/'))) return true;
  // Electron may use file:// during compose before upload.
  if (allowLocal && /^file:/i.test(trimmed)) return true;
  return false;
}

function sanitizeStyle(style: string): string {
  // Only keep color declarations.
  const parts = style.split(';').map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const match = part.match(/^color\s*:\s*(.+)$/i);
    if (!match) continue;
    const color = match[1].trim();
    if (/^(#[0-9a-f]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|[a-z]+)$/i.test(color)) {
      kept.push(`color: ${color}`);
    }
  }
  return kept.join('; ');
}

function walkSanitize(node: Node, allowLocalImg: boolean): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'FORM' || tag === 'STYLE') {
    return null;
  }

  // Unwrap unknown tags but keep children.
  if (!ALLOWED_TAGS.has(tag) && tag !== 'FONT') {
    const frag = document.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const next = walkSanitize(child, allowLocalImg);
      if (next) frag.appendChild(next);
    }
    return frag;
  }

  const outTag = tag === 'FONT' ? 'SPAN' : tag;
  const out = document.createElement(outTag);
  const allowed = ALLOWED_ATTR[tag] ?? ALLOWED_ATTR[outTag];

  if (allowed) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) continue;
      if (!allowed.has(attr.name) && !allowed.has(name)) {
        // FONT color → style
        if (tag === 'FONT' && name === 'color') {
          const color = attr.value.trim();
          if (/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color)) {
            out.setAttribute('style', `color: ${color}`);
          }
        }
        continue;
      }

      if (name === 'href') {
        if (!isSafeHref(attr.value)) continue;
        out.setAttribute('href', attr.value.trim());
        out.setAttribute('rel', 'noopener noreferrer');
        if (el.getAttribute('target') === '_blank') {
          out.setAttribute('target', '_blank');
        }
        continue;
      }

      if (name === 'src') {
        if (!isSafeImgSrc(attr.value, { allowLocal: allowLocalImg })) continue;
        out.setAttribute('src', attr.value.trim());
        continue;
      }

      if (name === 'style') {
        const cleaned = sanitizeStyle(attr.value);
        if (cleaned) out.setAttribute('style', cleaned);
        continue;
      }

      if (name === 'alt' || name === 'width' || name === 'height') {
        out.setAttribute(name, attr.value);
      }
    }
  }

  for (const child of Array.from(el.childNodes)) {
    const next = walkSanitize(child, allowLocalImg);
    if (next) out.appendChild(next);
  }
  return out;
}

/**
 * Sanitize rich HTML.
 * @param allowLocalImg keep blob/data/file src for in-composer editing; strip before send.
 */
export function sanitizeImRichHtml(html: string, options?: { allowLocalImg?: boolean }): string {
  const allowLocalImg = options?.allowLocalImg ?? false;
  if (!html.trim()) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';

  const outRoot = document.createElement('div');
  for (const child of Array.from(root.childNodes)) {
    const next = walkSanitize(child, allowLocalImg);
    if (next) outRoot.appendChild(next);
  }
  return outRoot.innerHTML;
}

export function extractImRichPlainText(html: string): string {
  if (!html.trim()) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';
  // Images contribute a placeholder so empty-image-only messages are not treated as empty.
  root.querySelectorAll('img').forEach((img) => {
    img.replaceWith(doc.createTextNode('[图片]'));
  });
  return (root.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();
}

export function buildImRichPayload(html: string): ImRichPayload {
  const sanitized = sanitizeImRichHtml(html, { allowLocalImg: false });
  return {
    bizType: IM_RICH_BIZ_TYPE,
    version: IM_RICH_VERSION,
    html: sanitized,
    plainText: extractImRichPlainText(sanitized),
  };
}

export function serializeImRichPayload(payload: ImRichPayload): string {
  return JSON.stringify(payload);
}

export function parseImRichPayload(data: unknown): ImRichPayload | null {
  let raw: unknown = data;
  if (typeof data === 'string') {
    try {
      raw = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.bizType !== IM_RICH_BIZ_TYPE) return null;
  if (typeof record.html !== 'string') return null;
  const html = sanitizeImRichHtml(record.html, { allowLocalImg: false });
  const plainText = typeof record.plainText === 'string'
    ? record.plainText
    : extractImRichPlainText(html);
  return {
    bizType: IM_RICH_BIZ_TYPE,
    version: IM_RICH_VERSION,
    html,
    plainText,
  };
}

export function isImRichHtmlEmpty(html: string): boolean {
  if (!html.trim()) return true;
  const plain = extractImRichPlainText(html);
  if (plain) return false;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  return !root || root.querySelectorAll('img').length === 0;
}
