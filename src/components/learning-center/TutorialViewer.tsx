import { createElement, useState, type CSSProperties, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { openExternalUrl } from '@/lib/preview-url';
import './TutorialViewer.css';

export interface TutorialViewerProps {
  html: string;
  className?: string;
  imageErrorLabel?: string;
}

const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'VIDEO', 'AUDIO']);
const ALLOWED_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'P', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'BR', 'A', 'IMG',
]);
const VOID_TAGS = new Set(['BR', 'HR']);
const TAG_MAP: Record<string, string> = { B: 'strong', I: 'em', DEL: 's' };

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function safeLinkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function safeStyle(element: Element): CSSProperties | undefined {
  const style: CSSProperties = {};
  const fontSize = element.getAttribute('style')?.match(/(?:^|;)\s*font-size\s*:\s*(\d{1,2})px/i)?.[1];
  if (fontSize && Number(fontSize) >= 10 && Number(fontSize) <= 72) style.fontSize = `${fontSize}px`;

  const rawStyle = element.getAttribute('style') ?? '';
  const color = rawStyle.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/i)?.[1];
  const backgroundColor = rawStyle.match(/(?:^|;)\s*background-color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/i)?.[1];
  const fontFamily = rawStyle.match(/(?:^|;)\s*font-family\s*:\s*([\w\s,"'-]{1,80})/i)?.[1];
  const textAlign = rawStyle.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i)?.[1] as CSSProperties['textAlign'] | undefined;
  if (color) style.color = color;
  if (backgroundColor) style.backgroundColor = backgroundColor;
  if (fontFamily) style.fontFamily = fontFamily;
  if (textAlign) style.textAlign = textAlign;
  return Object.keys(style).length ? style : undefined;
}

function imageWidth(element: Element): number | null {
  const value = element.getAttribute('data-width') ?? element.getAttribute('width') ?? '';
  const parsed = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(parsed) && parsed >= 10 && parsed <= 100 ? parsed : null;
}

function renderNodes(
  nodes: NodeListOf<ChildNode> | ChildNode[],
  path: string,
  failedImages: Set<string>,
  failImage: (src: string) => void,
  imageErrorLabel: string,
): ReactNode[] {
  return Array.from(nodes).flatMap((node, index): ReactNode[] => {
    const key = `${path}-${index}`;
    if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? ''];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const element = node as Element;
    if (BLOCKED_TAGS.has(element.tagName)) return [];
    if (VOID_TAGS.has(element.tagName)) {
      const tagName = TAG_MAP[element.tagName] ?? element.tagName.toLowerCase();
      const voidNode = createElement(tagName, { key, style: safeStyle(element) });
      const leftover = renderNodes(element.childNodes, `${key}-after`, failedImages, failImage, imageErrorLabel);
      return leftover.length ? [voidNode, ...leftover] : [voidNode];
    }
    const children = renderNodes(element.childNodes, key, failedImages, failImage, imageErrorLabel);
    if (!ALLOWED_TAGS.has(element.tagName)) return children;

    if (element.tagName === 'IMG') {
      const source = safeHttpUrl(element.getAttribute('src') ?? '');
      const alt = element.getAttribute('alt')?.trim() || imageErrorLabel;
      if (!source || failedImages.has(source)) {
        return [
          <span key={key} className="tutorial-image-fallback" role="img" aria-label={`${alt}：${imageErrorLabel}`}>
            <ImageOff className="h-6 w-6" aria-hidden />
            <span>{imageErrorLabel}</span>
          </span>,
        ];
      }
      const width = imageWidth(element);
      const imageStyle = width
        ? { width: `${width}%`, '--tutorial-image-width': `${width}%` } as CSSProperties
        : undefined;
      return [
        <img
          key={key}
          className={width && width <= 50 ? 'tutorial-viewer__image tutorial-viewer__image--compact' : 'tutorial-viewer__image'}
          src={source}
          alt={alt}
          loading="lazy"
          data-width={width ?? undefined}
          style={imageStyle}
          onError={() => failImage(source)}
        />,
      ];
    }

    if (element.tagName === 'A') {
      const href = safeLinkUrl(element.getAttribute('href') ?? '');
      if (!href) return children;
      return [
        <a
          key={key}
          className="tutorial-viewer__link"
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(event) => {
            event.preventDefault();
            if (href.startsWith('http://') || href.startsWith('https://')) openExternalUrl(href);
          }}
        >
          {children}
        </a>,
      ];
    }

    const indent = element.getAttribute('data-indent');
    const safeIndent = indent && /^[1-6]$/.test(indent) ? indent : undefined;
    const tagName = TAG_MAP[element.tagName] ?? element.tagName.toLowerCase();
    return [createElement(tagName, { key, style: safeStyle(element), 'data-indent': safeIndent }, children)];
  });
}

export function TutorialViewer({ html, className = '', imageErrorLabel = '图片加载失败' }: TutorialViewerProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  let content: ReactNode = html;
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html');
    content = renderNodes(document.body.childNodes, 'root', failedImages, (source) => {
      setFailedImages((current) => new Set(current).add(source));
    }, imageErrorLabel);
  }

  return (
    <article className={`tutorial-viewer ${className}`.trim()} data-testid="tutorial-viewer">
      {content}
    </article>
  );
}
