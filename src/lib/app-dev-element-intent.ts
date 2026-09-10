/**
 * 选中区域对话修改：组包给模型的 prompt，以及历史气泡回显用的解析。
 * 完整选择器 / 样式摘要只进 gateway 正文；用户侧只展示意图 + 元素清单。
 */

export const SCLAW_ELEMENT_INTENT_FENCE = 'sclaw_element_intent';

export interface AppDevElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AppDevElementTuneKind = 'text' | 'image' | 'button' | 'container' | 'table';

export interface AppDevPickedElement {
  selector: string;
  tag: string;
  text?: string;
  styles?: Record<string, string>;
  rect?: AppDevElementRect;
  kind?: AppDevElementTuneKind;
  src?: string;
  alt?: string;
  href?: string;
  a2uiPageId?: string;
  a2uiSurfaceId?: string;
  a2uiComponentId?: string;
  a2uiComponent?: string;
}

export interface AppDevElementIntentView {
  intent: string;
  elements: AppDevPickedElement[];
}

interface AppDevElementIntentPayload {
  v: 1;
  intent: string;
  elements: Array<{
    selector: string;
    tag: string;
    text?: string;
  }>;
}

const FENCE_RE = /```sclaw_element_intent\s*([\s\S]*?)```/i;
const LEGACY_INTENT_RE = /修改意图：([^\n]+)/;
const LEGACY_MARKER = '请只修改下列选中元素相关代码';

export function formatAppDevElementLabel(el: Pick<AppDevPickedElement, 'selector' | 'tag'>): string {
  const selector = el.selector.trim();
  if (selector) {
    return selector.length > 32 ? `${selector.slice(0, 30)}…` : selector;
  }
  return (el.tag || 'div').toLowerCase();
}

export function formatAppDevElementCaption(el: AppDevPickedElement): string {
  const tag = (el.tag || 'div').toLowerCase();
  const excerpt = el.text?.replace(/\s+/g, ' ').trim();
  if (excerpt) return `${tag} · “${excerpt.slice(0, 24)}${excerpt.length > 24 ? '…' : ''}”`;
  return tag;
}

function serializePayload(intent: string, elements: AppDevPickedElement[]): AppDevElementIntentPayload {
  return {
    v: 1,
    intent,
    elements: elements.map((el) => ({
      selector: el.selector,
      tag: el.tag,
      ...(el.text ? { text: el.text.slice(0, 80) } : {}),
    })),
  };
}

/** 模型收到的完整约束；历史回显靠末尾 fence 还原意图与元素。 */
export function buildElementIntentPrompt(
  intent: string,
  elements: AppDevPickedElement[],
): string {
  const cleanedIntent = intent.trim();
  const lines = elements.map((el, index) => {
    const style = el.styles ? JSON.stringify(el.styles) : '{}';
    const textHint = el.text ? ` / "${el.text.slice(0, 40)}"` : '';
    return `${index + 1}. 选择器 \`${el.selector}\`（${el.tag}${textHint}）；当前样式摘要：${style}`;
  });
  return [
    cleanedIntent,
    '',
    `${LEGACY_MARKER}，不要改动无关区域。`,
    ...lines,
    '',
    `\`\`\`${SCLAW_ELEMENT_INTENT_FENCE}`,
    JSON.stringify(serializePayload(cleanedIntent, elements)),
    '```',
  ].join('\n');
}

function parseFencePayload(raw: string): AppDevElementIntentView | null {
  try {
    const parsed = JSON.parse(raw.trim()) as AppDevElementIntentPayload;
    if (!parsed || parsed.v !== 1 || typeof parsed.intent !== 'string') return null;
    if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) return null;
    const elements = parsed.elements.flatMap((item) => {
      if (!item || typeof item.selector !== 'string' || typeof item.tag !== 'string') return [];
      return [{
        selector: item.selector,
        tag: item.tag,
        ...(typeof item.text === 'string' && item.text.trim() ? { text: item.text } : {}),
      }];
    });
    const intent = parsed.intent.trim();
    if (!intent || elements.length === 0) return null;
    return { intent, elements };
  } catch {
    return null;
  }
}

/** 从用户消息正文还原选中区域意图；无 fence 时兼容旧版「修改意图：」组包。 */
export function parseAppDevElementIntent(text: string): AppDevElementIntentView | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(FENCE_RE);
  if (fence?.[1]) {
    const fromFence = parseFencePayload(fence[1]);
    if (fromFence) return fromFence;
  }
  if (!trimmed.includes(LEGACY_MARKER)) return null;
  const intent = trimmed.match(LEGACY_INTENT_RE)?.[1]?.trim();
  if (!intent) return null;
  const elements: AppDevPickedElement[] = [];
  const lineRe = /^\d+\.\s*选择器\s*`([^`]+)`（([^/）]+)(?:\s*\/\s*"([^"]*)")?）/gm;
  let match: RegExpExecArray | null = lineRe.exec(trimmed);
  while (match) {
    elements.push({
      selector: match[1],
      tag: match[2].trim(),
      ...(match[3] ? { text: match[3] } : {}),
    });
    match = lineRe.exec(trimmed);
  }
  if (elements.length === 0) return null;
  return { intent, elements };
}
