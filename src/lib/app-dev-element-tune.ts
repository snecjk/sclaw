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
  | 'lineHeight'
  | 'textAlign'
  | 'borderRadius'
  | 'borderWidth'
  | 'borderColor'
  | 'src'
  | 'alt'
  | 'objectFit'
  | 'width'
  | 'height'
  | 'padding'
  | 'margin'
  | 'boxModel'
  | 'gap'
  | 'display'
  | 'flexDirection'
  | 'flexWrap'
  | 'justifyContent'
  | 'alignItems'
  | 'opacity';

export type AppDevTuneSectorId =
  | 'content'
  | 'font'
  | 'layout'
  | 'size'
  | 'spacing'
  | 'background'
  | 'border'
  | 'image';

export type CssLengthUnit = 'px' | '%' | 'auto';

export interface CssLength {
  value: number;
  unit: CssLengthUnit;
}

export interface CssBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 重置 / 清空 live patch 时覆盖的 CSS 属性。 */
export const ELEMENT_TUNE_STYLE_KEYS = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'border-radius',
  'border-width',
  'border-color',
  'border-style',
  'object-fit',
  'padding',
  'margin',
  'gap',
  'width',
  'height',
  'opacity',
  'display',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'justify-items',
  'align-items',
] as const;

export function emptyElementTuneStyles(): Record<string, string> {
  return Object.fromEntries(ELEMENT_TUNE_STYLE_KEYS.map((key) => [key, '']));
}

export interface AppDevTuneSector {
  id: AppDevTuneSectorId;
  title: string;
  fields: AppDevElementTuneField[];
}

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

const LAYOUT_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'nav', 'aside', 'main', 'article',
  'ul', 'ol', 'form', 'fieldset',
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
  const tag = (el.tag || '').toLowerCase();
  const a2ui = (el.a2uiComponent || '').toLowerCase();
  if (a2ui.includes('table') || tag === 'table' || tag === 'thead' || tag === 'tbody') return 'table';
  if (tag === 'img' || tag === 'picture' || tag === 'svg') return 'image';
  if (tag === 'button' || tag === 'input' || a2ui.includes('button')) return 'button';
  if (tag === 'a') {
    const background = el.styles?.background ?? '';
    if (background && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0/.test(background) && background !== 'transparent') {
      return 'button';
    }
    return 'text';
  }
  if (TEXT_TAGS.has(tag)) return 'text';
  if (LAYOUT_TAGS.has(tag)) return 'container';
  const text = (el.text ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 0 && text.length <= 80) return 'text';
  return 'container';
}

/** 对齐：文字用 text-align；容器同时写成 flex，子节点才会跟着动。 */
export function expandAlignmentStyles(
  align: 'left' | 'center' | 'right',
  asFlex = false,
): Record<string, string> {
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  if (!asFlex) {
    return { 'text-align': align };
  }
  return {
    display: 'flex',
    'text-align': align,
    'justify-content': justify,
    'justify-items': align,
  };
}

function isFlexDisplay(display: string | undefined): boolean {
  return display === 'flex' || display === 'inline-flex';
}

export function elementTuneSectorsForKind(
  kind: AppDevElementTuneKind,
  el?: AppDevPickedElement,
  display?: string,
): AppDevTuneSector[] {
  const layoutDisplay = (display || el?.styles?.display || '').split(' ')[0];
  if (kind === 'text') {
    return [
      { id: 'content', title: '内容', fields: ['text'] },
      { id: 'font', title: '文字', fields: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign'] },
      { id: 'spacing', title: '间距', fields: ['margin'] },
    ];
  }
  if (kind === 'button') {
    return [
      { id: 'content', title: '内容', fields: ['text'] },
      { id: 'font', title: '文字', fields: ['color', 'fontSize', 'fontWeight'] },
      { id: 'background', title: '背景', fields: ['background', 'opacity'] },
      { id: 'border', title: '边框', fields: ['borderWidth', 'borderColor', 'borderRadius'] },
      { id: 'spacing', title: '间距', fields: ['boxModel'] },
    ];
  }
  if (kind === 'image') {
    return [
      { id: 'image', title: '图片', fields: ['src', 'alt', 'objectFit'] },
      { id: 'size', title: '尺寸', fields: ['width', 'height'] },
      { id: 'border', title: '边框', fields: ['borderRadius'] },
      { id: 'spacing', title: '间距', fields: ['margin'] },
    ];
  }
  if (kind === 'table') {
    return [
      { id: 'font', title: '文字', fields: ['color', 'fontSize', 'fontWeight', 'textAlign'] },
      { id: 'size', title: '尺寸', fields: ['width'] },
      { id: 'background', title: '背景', fields: ['background', 'opacity'] },
      { id: 'spacing', title: '间距', fields: ['boxModel'] },
      { id: 'border', title: '边框', fields: ['borderWidth', 'borderColor', 'borderRadius'] },
    ];
  }
  const layoutFields: AppDevElementTuneField[] = ['display'];
  if (isFlexDisplay(layoutDisplay) || !layoutDisplay) {
    layoutFields.push('flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap');
  }
  layoutFields.push('textAlign');
  const sectors: AppDevTuneSector[] = [
    { id: 'layout', title: '布局', fields: layoutFields },
    { id: 'size', title: '尺寸', fields: ['width', 'height'] },
    { id: 'spacing', title: '间距', fields: ['boxModel'] },
    { id: 'background', title: '背景', fields: ['background', 'opacity'] },
    { id: 'border', title: '边框', fields: ['borderWidth', 'borderColor', 'borderRadius'] },
  ];
  if (el?.text?.trim()) {
    sectors.unshift({ id: 'content', title: '内容', fields: ['text'] });
  }
  return sectors;
}

export function elementTuneFieldsForKind(
  kind: AppDevElementTuneKind,
  el?: AppDevPickedElement,
): AppDevElementTuneField[] {
  return elementTuneSectorsForKind(kind, el).flatMap((sector) => sector.fields);
}

export function parseCssPx(input: string | undefined): number | null {
  if (!input) return null;
  const first = input.trim().split(/\s+/)[0] ?? '';
  if (first === 'auto' || first === 'normal' || first === 'none') return null;
  const px = first.match(/^([0-9.]+)px$/i);
  if (px) return Number(px[1]);
  const rem = first.match(/^([0-9.]+)rem$/i);
  if (rem) return Number(rem[1]) * 16;
  const pct = first.match(/^([0-9.]+)%$/i);
  if (pct) return Number(pct[1]);
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

export function parseCssLength(input: string | undefined): CssLength | null {
  if (!input) return null;
  const first = input.trim().split(/\s+/)[0] ?? '';
  if (!first || first === 'none') return null;
  if (first === 'auto') return { value: 0, unit: 'auto' };
  const pct = first.match(/^([0-9.]+)%$/i);
  if (pct) return { value: Number(pct[1]), unit: '%' };
  const px = parseCssPx(first);
  if (px == null) return null;
  return { value: px, unit: 'px' };
}

export function formatCssLength(length: CssLength): string {
  if (length.unit === 'auto') return 'auto';
  const n = Number.isInteger(length.value) ? String(length.value) : length.value.toFixed(1).replace(/\.0$/, '');
  return `${n}${length.unit}`;
}

export function parseCssBox(
  shorthand?: string,
  sides?: { top?: string; right?: string; bottom?: string; left?: string },
): CssBox {
  const fromSides = {
    top: parseCssPx(sides?.top),
    right: parseCssPx(sides?.right),
    bottom: parseCssPx(sides?.bottom),
    left: parseCssPx(sides?.left),
  };
  if (shorthand?.trim()) {
    const parts = shorthand.trim().split(/\s+/).map((part) => parseCssPx(part) ?? 0);
    if (parts.length === 1) {
      const n = parts[0] ?? 0;
      return { top: n, right: n, bottom: n, left: n };
    }
    if (parts.length === 2) {
      return { top: parts[0] ?? 0, right: parts[1] ?? 0, bottom: parts[0] ?? 0, left: parts[1] ?? 0 };
    }
    if (parts.length === 3) {
      return { top: parts[0] ?? 0, right: parts[1] ?? 0, bottom: parts[2] ?? 0, left: parts[1] ?? 0 };
    }
    return {
      top: parts[0] ?? 0,
      right: parts[1] ?? 0,
      bottom: parts[2] ?? 0,
      left: parts[3] ?? 0,
    };
  }
  return {
    top: fromSides.top ?? 0,
    right: fromSides.right ?? 0,
    bottom: fromSides.bottom ?? 0,
    left: fromSides.left ?? 0,
  };
}

export function formatCssBox(box: CssBox): string {
  const t = Math.round(box.top);
  const r = Math.round(box.right);
  const b = Math.round(box.bottom);
  const l = Math.round(box.left);
  if (t === r && r === b && b === l) return `${t}px`;
  if (t === b && l === r) return `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

export function isUniformCssBox(box: CssBox): boolean {
  return box.top === box.right && box.right === box.bottom && box.bottom === box.left;
}

export function parseCssOpacity(input: string | undefined): number {
  if (!input) return 1;
  const n = Number(input);
  if (!Number.isFinite(n)) return 1;
  return n > 1 ? n / 100 : n;
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
    .map(([name, value]) => {
      const trimmed = value.trim().replace(/\s*!important\s*$/i, '');
      return `  ${name}: ${trimmed} !important;`;
    })
    .join('\n');
  if (!decls) return '';
  return `${selector} {\n${decls}\n}`;
}

/** 填色要盖过组件 class / 渐变，并画到铺满的第一层子节点。 */
export function expandElementTunePaintStyles(styles: Record<string, string>): Record<string, string> {
  const fill = styles['background-color']?.trim() || styles.background?.trim();
  if (!fill) return { ...styles };
  return {
    ...styles,
    background: fill,
    'background-color': fill,
    'background-image': 'none',
  };
}

export function elementTuneOverrideSelector(
  selector: string,
  styles: Record<string, string>,
): string {
  if (styles['background-color'] || styles.background) {
    return `${selector},\n${selector} > :first-child`;
  }
  return selector;
}

export function upsertElementOverrideCssBlock(
  css: string,
  selector: string,
  styles: Record<string, string>,
): string {
  const painted = expandElementTunePaintStyles(styles);
  const id = hashSelector(selector);
  const begin = `/* sclaw-el:${id} */`;
  const end = `/* /sclaw-el:${id} */`;
  const rule = serializeElementOverrideRule(elementTuneOverrideSelector(selector, painted), painted);
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
  const dirty = expandElementTunePaintStyles(Object.fromEntries(
    Object.entries(styles).filter(([, value]) => value.trim()),
  ));
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
  const css = await persistThemeCss(
    workspaceId,
    original.selector,
    expandElementTunePaintStyles(draft.styles),
  );
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
