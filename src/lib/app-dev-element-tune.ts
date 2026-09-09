/**
 * 手动微调选区：按 DOM 类型出编辑字段、live patch、theme.css / 文案落盘。
 */
import {
  readAppSourceFile,
  searchAppSourceFiles,
  writeAppSourceFile,
  type AppSourceSearchHit,
} from '@/lib/app-dev-api';
import {
  a2uiPageJsonPath,
  applyA2uiVisibleText,
  type A2uiMessage,
} from '@/lib/app-dev-a2ui-page';
import type { AppDevElementTuneKind, AppDevPickedElement } from '@/lib/app-dev-element-intent';

export type AppDevElementTuneField =
  | 'text'
  | 'color'
  | 'background'
  | 'fontSize'
  | 'fontWeight'
  | 'textAlign'
  | 'borderRadius'
  | 'src'
  | 'alt'
  | 'objectFit';

export interface AppDevElementTuneDraft {
  text?: string;
  src?: string;
  alt?: string;
  styles: Record<string, string>;
}

export interface AppDevElementTunePersistResult {
  cssPath?: string;
  sourcePath?: string;
  notes: string[];
}

const THEME_CANDIDATES = ['src/theme/theme.css', 'frontend/src/theme/theme.css'];

const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'label', 'li', 'em', 'strong', 'small', 'td', 'th',
]);

function blankToUndef(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** 圈选回传补 kind，并去掉空的 a2ui / src 字段。 */
export function normalizeAppDevPickedElement(el: AppDevPickedElement): AppDevPickedElement {
  const next: AppDevPickedElement = {
    ...el,
    src: blankToUndef(el.src),
    alt: blankToUndef(el.alt),
    href: blankToUndef(el.href),
    a2uiPageId: blankToUndef(el.a2uiPageId),
    a2uiSurfaceId: blankToUndef(el.a2uiSurfaceId),
    a2uiComponentId: blankToUndef(el.a2uiComponentId),
    a2uiComponent: blankToUndef(el.a2uiComponent),
  };
  next.kind = classifyAppDevElementTuneKind(next);
  return next;
}

export function classifyAppDevElementTuneKind(el: AppDevPickedElement): AppDevElementTuneKind {
  if (el.kind) return el.kind;
  const tag = (el.tag || '').toLowerCase();
  if (tag === 'img' || tag === 'picture' || tag === 'svg' || Boolean(el.src)) return 'image';
  if (tag === 'button' || tag === 'input') return 'button';
  if (tag === 'a') {
    const background = el.styles?.background ?? '';
    if (background && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0/.test(background) && background !== 'transparent') {
      return 'button';
    }
    return 'text';
  }
  if (TEXT_TAGS.has(tag)) return 'text';
  const text = (el.text ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 0 && text.length <= 80 && tag !== 'div') return 'text';
  return 'container';
}

export function elementTuneFieldsForKind(
  kind: AppDevElementTuneKind,
  el?: AppDevPickedElement,
): AppDevElementTuneField[] {
  if (kind === 'text') return ['text', 'color', 'fontSize', 'fontWeight', 'textAlign'];
  if (kind === 'button') return ['text', 'color', 'background', 'fontSize', 'borderRadius'];
  if (kind === 'image') return ['src', 'alt', 'borderRadius', 'objectFit'];
  const fields: AppDevElementTuneField[] = ['background', 'borderRadius', 'color'];
  if (el?.text?.trim()) fields.unshift('text');
  return fields;
}

export function parseCssPx(input: string | undefined): number | null {
  if (!input) return null;
  const px = input.trim().match(/^([0-9.]+)px$/i);
  if (px) return Number(px[1]);
  const rem = input.trim().match(/^([0-9.]+)rem$/i);
  if (rem) return Number(rem[1]) * 16;
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

export function normalizeFontWeight(input: string | undefined): string {
  const value = (input ?? '').trim().toLowerCase();
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  if (['400', '500', '600', '700'].includes(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return '400';
  if (n >= 650) return '700';
  if (n >= 550) return '600';
  if (n >= 450) return '500';
  return '400';
}

export function hashSelector(selector: string): string {
  let hash = 0;
  for (let i = 0; i < selector.length; i += 1) {
    hash = ((hash << 5) - hash + selector.charCodeAt(i)) | 0;
  }
  return `e${(hash >>> 0).toString(36)}`;
}

export function serializeElementOverrideRule(
  selector: string,
  styles: Record<string, string>,
): string {
  const decls = Object.entries(styles)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  if (!decls) return '';
  return `${selector} {\n${decls}\n}`;
}

export function upsertElementOverrideCssBlock(
  css: string,
  selector: string,
  styles: Record<string, string>,
): string {
  const id = hashSelector(selector);
  const begin = `/* sclaw-el:${id} */`;
  const end = `/* /sclaw-el:${id} */`;
  const rule = serializeElementOverrideRule(selector, styles);
  const block = rule ? `${begin}\n${rule}\n${end}` : '';
  const startIdx = css.indexOf(begin);
  if (startIdx >= 0) {
    const endIdx = css.indexOf(end, startIdx);
    if (endIdx >= 0) {
      const after = css.slice(endIdx + end.length);
      const next = `${css.slice(0, startIdx)}${block}${after}`;
      return next.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
    }
  }
  if (!block) return css;
  return `${css.replace(/\s+$/, '')}\n\n${block}\n`;
}

export function replaceUniqueSourceText(content: string, from: string, to: string): string | null {
  if (!from || from === to) return content;
  const parts = content.split(from);
  if (parts.length !== 2) return null;
  return parts.join(to);
}

export function pickUniqueTextSearchHit(hits: AppSourceSearchHit[], from: string): string | null {
  const paths = [...new Set(
    hits.filter((hit) => hit.preview.includes(from)).map((hit) => hit.path),
  )];
  return paths.length === 1 ? paths[0] : null;
}

export function draftHasChanges(
  original: AppDevPickedElement,
  draft: AppDevElementTuneDraft,
): boolean {
  if ((draft.text ?? original.text ?? '') !== (original.text ?? '')) return true;
  if ((draft.src ?? original.src ?? '') !== (original.src ?? '')) return true;
  if ((draft.alt ?? original.alt ?? '') !== (original.alt ?? '')) return true;
  return Object.values(draft.styles).some((value) => value.trim().length > 0);
}

async function persistThemeCss(
  workspaceId: string,
  selector: string,
  styles: Record<string, string>,
): Promise<{ path?: string; note?: string }> {
  const dirty = Object.fromEntries(
    Object.entries(styles).filter(([, value]) => value.trim()),
  );
  if (Object.keys(dirty).length === 0) return {};
  for (const path of THEME_CANDIDATES) {
    try {
      const file = await readAppSourceFile(workspaceId, path);
      const next = upsertElementOverrideCssBlock(file.content, selector, dirty);
      if (next !== file.content) {
        await writeAppSourceFile(workspaceId, path, next);
      }
      return { path };
    } catch {
      // try next candidate
    }
  }
  return { note: '未找到 src/theme/theme.css，样式仅在预览中生效' };
}

async function persistUniqueLiteral(
  workspaceId: string,
  from: string | undefined,
  to: string | undefined,
  label: string,
): Promise<{ path?: string; note?: string }> {
  const previous = (from ?? '').trim();
  const next = (to ?? '').trim();
  if (!previous || previous === next) return {};
  if (previous.length < 2) {
    return { note: `${label}过短，未写入源码` };
  }
  const hits = await searchAppSourceFiles(workspaceId, previous.slice(0, 200));
  const path = pickUniqueTextSearchHit(hits, previous);
  if (!path) {
    return { note: `${label}在多处出现或未找到，预览已更新；代码请用对话修改` };
  }
  const file = await readAppSourceFile(workspaceId, path);
  const replaced = replaceUniqueSourceText(file.content, previous, next);
  if (replaced == null) {
    return { note: `${label}在 ${path} 中不是唯一出现，未写入源码` };
  }
  await writeAppSourceFile(workspaceId, path, replaced);
  return { path };
}

async function persistA2uiVisibleText(
  workspaceId: string,
  original: AppDevPickedElement,
  text: string | undefined,
): Promise<{ path?: string; note?: string }> {
  const pageId = original.a2uiPageId?.trim();
  const componentId = original.a2uiComponentId?.trim();
  if (!pageId || !componentId) return {};
  const previous = (original.text ?? '').trim();
  const next = (text ?? '').trim();
  if (!next || previous === next) return {};
  const path = a2uiPageJsonPath(pageId);
  try {
    const file = await readAppSourceFile(workspaceId, path);
    const messages = JSON.parse(file.content) as A2uiMessage[];
    const patched = applyA2uiVisibleText(messages, componentId, next);
    if (JSON.stringify(patched) === JSON.stringify(messages)) {
      return { note: '该 A2UI 节点没有可写文案字段，请用数据栏或对话修改' };
    }
    await writeAppSourceFile(workspaceId, path, `${JSON.stringify(patched, null, 2)}\n`);
    return { path };
  } catch {
    return { note: '未能写入 page.json' };
  }
}

export async function persistAppDevElementTune(
  workspaceId: string,
  original: AppDevPickedElement,
  draft: AppDevElementTuneDraft,
): Promise<AppDevElementTunePersistResult> {
  const notes: string[] = [];
  const css = await persistThemeCss(workspaceId, original.selector, draft.styles);
  if (css.note) notes.push(css.note);
  const a2uiText = await persistA2uiVisibleText(workspaceId, original, draft.text);
  if (a2uiText.note) notes.push(a2uiText.note);
  const text = a2uiText.path
    ? { path: a2uiText.path }
    : await persistUniqueLiteral(workspaceId, original.text, draft.text, '文案');
  if (text.note) notes.push(text.note);
  const src = await persistUniqueLiteral(workspaceId, original.src, draft.src, '图片地址');
  if (src.note) notes.push(src.note);
  const alt = await persistUniqueLiteral(workspaceId, original.alt, draft.alt, '图片说明');
  if (alt.note) notes.push(alt.note);
  if (!css.path && !text.path && !src.path && !alt.path && notes.length === 0) {
    notes.push('没有需要落盘的改动');
  }
  return {
    cssPath: css.path,
    sourcePath: text.path || src.path || alt.path,
    notes,
  };
}
