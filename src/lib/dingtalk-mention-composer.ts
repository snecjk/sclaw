import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { skillComposerTagClass } from '@/lib/surfaces';

export const MENTION_SPAN_CLASS = 'dingtalk-mention-token';
export const MENTION_SPAN_SELECTOR = `span.${MENTION_SPAN_CLASS}`;

export const WORKFLOW_SPAN_CLASS = 'workflow-token';
export const WORKFLOW_SPAN_SELECTOR = `span.${WORKFLOW_SPAN_CLASS}`;

export const SKILL_SPAN_CLASS = 'skill-token';
export const SKILL_SPAN_SELECTOR = `span.${SKILL_SPAN_CLASS}`;

export interface MentionComposerSnapshot {
  plainText: string;
  mentions: DingTalkMention[];
  workflowId?: string;
  /** 工作流名称（与 token 文本一致，供上下文块使用）。 */
  workflowName?: string;
  /** 工作流来源：'mine' = 我的工作流-已发布（直接以工作流上下文发送）；缺省 = 模版（走参数表单）。 */
  workflowSource?: string;
  skill?: SkillMeta;
  isEmpty: boolean;
}

export interface ActiveMentionTrigger {
  query: string;
  /** Plain-text start offset of `@`, inclusive. */
  startOffset: number;
  /** Plain-text end offset of caret, exclusive. */
  endOffset: number;
}

function isMentionSpan(node: Node | null): boolean {
  return node instanceof HTMLSpanElement && node.classList.contains(MENTION_SPAN_CLASS);
}

function isWorkflowSpan(node: Node | null): boolean {
  return node instanceof HTMLSpanElement && node.classList.contains(WORKFLOW_SPAN_CLASS);
}

function isSkillSpan(node: Node | null): boolean {
  return node instanceof HTMLSpanElement
    && (node.classList.contains(SKILL_SPAN_CLASS) || Boolean(node.dataset.skillSlug));
}

function readSkillFromSpan(span: HTMLSpanElement): SkillMeta | null {
  const slug = span.dataset.skillSlug;
  const title = span.dataset.skillTitle ?? span.querySelector('.skill-token-label')?.textContent?.trim() ?? '';
  if (!slug || !title) return null;
  return { slug, title };
}

export function readSkillMetaFromEditorRoot(root: HTMLElement): SkillMeta | undefined {
  const skillSpan = root.querySelector(SKILL_SPAN_SELECTOR)
    ?? root.querySelector('span[data-skill-slug]');
  if (!(skillSpan instanceof HTMLSpanElement)) return undefined;
  return readSkillFromSpan(skillSpan) ?? undefined;
}

function readMentionFromSpan(span: HTMLSpanElement): DingTalkMention | null {
  const type = span.dataset.mentionType;
  const displayName = span.dataset.mentionName ?? span.textContent?.replace(/^@/, '') ?? '';
  if (!displayName) return null;
  if (type === 'user') {
    const userId = span.dataset.userId;
    if (!userId) return null;
    return {
      type: 'user',
      displayName,
      userId,
      corpId: span.dataset.corpId || undefined,
    };
  }
  const openConversationId = span.dataset.openConversationId;
  if (!openConversationId) return null;
  return {
    type: 'group',
    displayName,
    openConversationId,
    corpId: span.dataset.corpId || undefined,
  };
}

export function serializeMentionEditor(root: HTMLElement): MentionComposerSnapshot {
  const mentions: DingTalkMention[] = [];
  let plainText = '';
  let workflowId: string | undefined;
  let workflowName: string | undefined;
  let workflowSource: string | undefined;
  let skill: SkillMeta | undefined;

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      plainText += node.textContent ?? '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    if (isMentionSpan(node)) {
      const mention = readMentionFromSpan(node);
      if (mention) {
        mentions.push(mention);
        plainText += `@${mention.displayName}`;
      }
      return;
    }

    if (isSkillSpan(node)) {
      const parsed = readSkillFromSpan(node);
      if (parsed) skill = parsed;
      return;
    }

    if (isWorkflowSpan(node)) {
      const span = node as HTMLSpanElement;
      const id = span.dataset.workflowId;
      if (id) {
        workflowId = id;
        workflowName = span.dataset.workflowName;
        workflowSource = span.dataset.workflowSource;
      }
      plainText += span.textContent ?? '';
      return;
    }

    const element = node as HTMLElement;
    if (element.tagName === 'BR') {
      plainText += '\n';
      return;
    }

    element.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);

  if (!skill) {
    const skillSpan = root.querySelector(SKILL_SPAN_SELECTOR)
      ?? root.querySelector('span[data-skill-slug]');
    if (skillSpan instanceof HTMLSpanElement) {
      const parsed = readSkillFromSpan(skillSpan);
      if (parsed) skill = parsed;
    }
  }

  let normalized = plainText.replace(/\u00A0/g, ' ');
  if (skill) {
    normalized = normalized.replace(/^\s+/, '');
  }
  return {
    plainText: normalized,
    mentions,
    workflowId,
    workflowName,
    workflowSource,
    skill,
    isEmpty: normalized.trim().length === 0 && mentions.length === 0 && !skill,
  };
}

/** 从 plainText 提取 `*` 之后的内联筛选关键词（composer 技能 Picker inline 模式）。 */
export function extractSkillInlineQuery(plainText: string): string {
  const idx = plainText.lastIndexOf('*');
  if (idx === -1) return '';
  return plainText.slice(idx + 1);
}

/** plainText 中是否包含技能 inline 触发符 `*`。 */
export function hasSkillInlineTrigger(plainText: string): boolean {
  return plainText.includes('*');
}

/**
 * 移除 editor 中 `*` 及其后的内联筛选文本（选中技能或取消 inline Picker 时调用）。
 * @param explicitQuery 选中技能时传入当前 filter，避免误删 `*` 之后用户已输入的正文
 * @returns 是否成功移除
 */
export function consumeSkillTriggerText(root: HTMLElement, explicitQuery?: string): boolean {
  const plainText = serializeMentionEditor(root).plainText;
  const startIdx = plainText.lastIndexOf('*');
  if (startIdx === -1) return false;

  const query = explicitQuery ?? extractSkillInlineQuery(plainText);
  const endIdx = startIdx + 1 + query.length;

  const range = buildRangeFromPlainTextOffsets(root, startIdx, endIdx);
  if (!range) return false;

  range.deleteContents();
  return true;
}

export function consumeSlashTriggerText(root: HTMLElement): boolean {
  const plainText = serializeMentionEditor(root).plainText;
  const startIdx = plainText.lastIndexOf('/');
  if (startIdx === -1) return false;

  const range = buildRangeFromPlainTextOffsets(root, startIdx, startIdx + 1);
  if (!range) return false;

  range.deleteContents();
  return true;
}

function collectTextBeforeCaret(root: HTMLElement, range: Range): string {
  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  try {
    preRange.setEnd(range.startContainer, range.startOffset);
  } catch {
    return '';
  }

  const container = document.createElement('div');
  container.appendChild(preRange.cloneContents());
  return serializeMentionEditor(container).plainText;
}

interface PlainTextBoundary {
  node: Node;
  offset: number;
}

function findPlainTextBoundary(root: HTMLElement, targetOffset: number): PlainTextBoundary | null {
  let current = 0;

  const visit = (node: Node): PlainTextBoundary | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const text = (textNode.data ?? '').replace(/\u00A0/g, ' ');
      const next = current + text.length;
      if (targetOffset <= next) {
        return { node: textNode, offset: targetOffset - current };
      }
      current = next;
      return null;
    }

    if (node instanceof HTMLElement && (isMentionSpan(node) || isWorkflowSpan(node) || isSkillSpan(node))) {
      if (isSkillSpan(node)) {
        return null;
      }
      // 与 serializeMentionEditor 保持一致：mention span 用 `@displayName`
      // （不含 removable 模式下 × 删除按钮的字符），否则偏移量会与序列化错位。
      const text = isMentionSpan(node)
        ? `@${node.dataset.mentionName ?? ''}`
        : (node.textContent ?? '');
      const next = current + text.length;
      // span 不可拆分：严格落在 (current, next) 内部才视为非法返回 null。
      // targetOffset === next 表示"紧贴 span 之后"的合法边界，必须推进 current
      // 让后续文本节点（如尾随的 ）在 offset 0 处匹配，否则会把紧挨着
      // 前一个 mention 输入的 @ 映射失败，导致 insertMentionAtTrigger 静默退出。
      if (targetOffset < next) {
        return null;
      }
      current = next;
      return null;
    }

    if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') {
        const next = current + 1;
        if (targetOffset <= next) {
          const parent = node.parentNode;
          if (!parent) return null;
          const index = Array.from(parent.childNodes).indexOf(node);
          return { node: parent, offset: index + (targetOffset === next ? 1 : 0) };
        }
        current = next;
        return null;
      }

      for (const child of Array.from(node.childNodes)) {
        const boundary = visit(child);
        if (boundary) return boundary;
      }
    }

    return null;
  };

  for (const child of Array.from(root.childNodes)) {
    const boundary = visit(child);
    if (boundary) return boundary;
  }

  return null;
}

function buildRangeFromPlainTextOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
): Range | null {
  const start = findPlainTextBoundary(root, startOffset);
  const end = findPlainTextBoundary(root, endOffset);
  if (!start || !end) return null;

  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

export function detectActiveMentionTrigger(root: HTMLElement): ActiveMentionTrigger | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const plainText = serializeMentionEditor(root).plainText;
  let beforeCaret = collectTextBeforeCaret(root, range);

  // contenteditable 在 input 瞬间光标常落后于 DOM 文本，导致 query 仍为空。
  if (beforeCaret.length < plainText.length) {
    const pending = plainText.slice(beforeCaret.length);
    if (pending.length > 0 && !/[\s@\n]/.test(pending)) {
      beforeCaret = plainText;
    }
  }

  const match = beforeCaret.match(/@([^\s@\n]*)$/);
  if (!match || match.index === undefined) return null;

  const query = match[1] ?? '';
  return {
    query,
    startOffset: match.index,
    endOffset: beforeCaret.length,
  };
}

export interface MentionSpanOptions {
  removable?: boolean;
}

const MENTION_SPAN_BASE_CLASS = [
  MENTION_SPAN_CLASS,
  'rounded-[3px]',
  'bg-[#E8F3FF]',
  'text-[#1677FF]',
  'font-medium',
  'dark:bg-[#1677FF]/15',
  'dark:text-[#4C9BFF]',
].join(' ');

const MENTION_REMOVE_BTN_CLASS = [
  'mention-remove-btn',
  'inline-flex',
  'h-3.5',
  'w-3.5',
  'shrink-0',
  'items-center',
  'justify-center',
  'rounded-full',
  'text-[11px]',
  'leading-none',
  'text-[#1677FF]/70',
  'transition-colors',
  'hover:bg-[#1677FF]/10',
  'hover:text-[#1677FF]',
  'dark:text-[#4C9BFF]/70',
  'dark:hover:bg-[#4C9BFF]/15',
  'dark:hover:text-[#4C9BFF]',
].join(' ');

export function createMentionSpan(mention: DingTalkMention, options?: MentionSpanOptions): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = options?.removable
    ? `${MENTION_SPAN_BASE_CLASS} inline-flex items-center gap-0.5 px-1 py-px`
    : `${MENTION_SPAN_BASE_CLASS} inline px-0.5`;
  span.contentEditable = 'false';
  span.dataset.mentionType = mention.type;
  span.dataset.mentionName = mention.displayName;
  if (mention.corpId) span.dataset.corpId = mention.corpId;
  if (mention.type === 'user' && mention.userId) {
    span.dataset.userId = mention.userId;
  }
  if (mention.type === 'group' && mention.openConversationId) {
    span.dataset.openConversationId = mention.openConversationId;
  }

  span.appendChild(document.createTextNode(`@${mention.displayName}`));

  if (options?.removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.dataset.mentionRemove = 'true';
    removeBtn.setAttribute('aria-label', '移除');
    removeBtn.className = MENTION_REMOVE_BTN_CLASS;
    removeBtn.textContent = '×';
    span.appendChild(removeBtn);
  }

  return span;
}

export function createWorkflowSpan(
  workflowId: string,
  name: string,
  source?: string,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = [
    WORKFLOW_SPAN_CLASS,
    'inline',
    'text-primary',
    'font-medium',
  ].join(' ');
  span.contentEditable = 'false';
  span.dataset.workflowId = workflowId;
  span.dataset.workflowName = name;
  if (source) span.dataset.workflowSource = source;
  span.textContent = `/${name}`;
  return span;
}

const SKILL_WRENCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

export function createSkillSpan(slug: string, title: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = skillComposerTagClass;
  span.contentEditable = 'false';
  span.dataset.skillSlug = slug;
  span.dataset.skillTitle = title;

  const icon = document.createElement('span');
  icon.className = 'skill-token-icon inline-flex shrink-0';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = SKILL_WRENCH_SVG;

  const label = document.createElement('span');
  label.className = 'skill-token-label';
  label.textContent = title;

  span.append(icon, label);
  return span;
}

function removeWorkflowSpanFromRoot(root: HTMLElement): void {
  const existing = root.querySelector(WORKFLOW_SPAN_SELECTOR);
  if (!(existing instanceof HTMLSpanElement)) return;
  const next = existing.nextSibling;
  existing.remove();
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next.textContent ?? '';
    if (text === '\u00A0' || text === ' ') {
      next.remove();
    }
  }
}

export function removeSkillSpan(root: HTMLElement): void {
  const existing = root.querySelector(SKILL_SPAN_SELECTOR);
  if (!(existing instanceof HTMLSpanElement)) return;
  const next = existing.nextSibling;
  existing.remove();
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next.textContent ?? '';
    if (text === '\u00A0' || text === ' ') {
      next.remove();
    }
  }
}

export function insertSkillSpan(root: HTMLElement, slug: string, title: string): void {
  const selection = window.getSelection();
  removeWorkflowSpanFromRoot(root);
  removeSkillSpan(root);

  const span = createSkillSpan(slug, title);
  const space = document.createTextNode('\u00A0');
  const fragment = document.createDocumentFragment();
  fragment.append(span, space);

  const first = root.firstChild;
  if (first) {
    root.insertBefore(fragment, first);
  } else {
    root.appendChild(fragment);
  }

  const caretRange = document.createRange();
  caretRange.setStart(space, 1);
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
}

export function removeMentionSpan(root: HTMLElement, span: HTMLSpanElement): void {
  if (!root.contains(span)) return;

  const next = span.nextSibling;
  span.remove();
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next.textContent ?? '';
    if (text === '\u00A0' || text === ' ') {
      next.remove();
    }
  }
}

export function insertMentionAtTrigger(
  root: HTMLElement,
  trigger: ActiveMentionTrigger,
  mention: DingTalkMention,
  options?: MentionSpanOptions,
): void {
  const selection = window.getSelection();
  const triggerRange = buildRangeFromPlainTextOffsets(root, trigger.startOffset, trigger.endOffset);
  if (!triggerRange) return;
  triggerRange.deleteContents();

  const mentionSpan = createMentionSpan(mention, options);
  const space = document.createTextNode('\u00A0');
  const fragment = document.createDocumentFragment();
  fragment.append(mentionSpan, space);
  triggerRange.insertNode(fragment);

  const caretRange = document.createRange();
  caretRange.setStart(space, 1);
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
}

export function insertWorkflowSpan(
  root: HTMLElement,
  workflowId: string,
  name: string,
  source?: string,
): void {
  const selection = window.getSelection();
  removeSkillSpan(root);
  const snapshot = serializeMentionEditor(root);
  const text = snapshot.plainText;
  const lastSlashIndex = text.lastIndexOf('/');

  if (lastSlashIndex >= 0) {
    const slashRange = buildRangeFromPlainTextOffsets(root, lastSlashIndex, lastSlashIndex + 1);
    if (slashRange) {
      slashRange.deleteContents();
    }
  }

  const span = createWorkflowSpan(workflowId, name, source);
  const space = document.createTextNode('\u00A0');

  // Insert at the end (or at the slash position if found)
  root.appendChild(span);
  root.appendChild(space);

  const caretRange = document.createRange();
  caretRange.setStart(space, 1);
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
}

export function removeMentionBeforeCaret(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;

  const { startContainer, startOffset } = range;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = startContainer as Text;
    const prev = textNode.previousSibling;
    if (prev && (isMentionSpan(prev) || isWorkflowSpan(prev) || isSkillSpan(prev))) {
      const text = textNode.data ?? '';
      const trailingSeparator = text === '\u00A0' || text === ' ';
      if (startOffset === 0 || (trailingSeparator && startOffset <= text.length)) {
        prev.remove();
        if (trailingSeparator || text === '') {
          textNode.remove();
        } else if (startOffset > 0) {
          textNode.deleteData(0, startOffset);
        }
        return true;
      }
    }
    if (startOffset > 0) return false;
    return false;
  }

  if (startContainer instanceof HTMLElement) {
    const index = startOffset - 1;
    const prev = startContainer.childNodes[index] ?? null;
    if (isMentionSpan(prev) || isWorkflowSpan(prev) || isSkillSpan(prev)) {
      prev.remove();
      const next = startContainer.childNodes[index] ?? null;
      if (next?.nodeType === Node.TEXT_NODE && (next.textContent === '\u00A0' || next.textContent === '')) {
        next.remove();
      }
      return true;
    }
  }

  return false;
}

export function clearMentionEditor(root: HTMLElement): void {
  root.innerHTML = '';
}

export function setMentionEditorPlainText(root: HTMLElement, text: string): void {
  root.textContent = text;
}

export function insertPlainTextAtCaret(root: HTMLElement, text: string): void {
  if (!text) return;
  root.focus();
  const selection = window.getSelection();
  if (!selection) {
    setMentionEditorPlainText(root, text);
    return;
  }
  if (selection.rangeCount === 0) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  document.execCommand('insertText', false, text);
}

export function setMentionEditorMentions(
  root: HTMLElement,
  mentions: DingTalkMention[],
  options?: MentionSpanOptions,
): void {
  root.innerHTML = '';
  if (mentions.length === 0) return;

  const fragment = document.createDocumentFragment();
  mentions.forEach((mention) => {
    fragment.appendChild(createMentionSpan(mention, options));
    fragment.appendChild(document.createTextNode('\u00A0'));
  });
  root.appendChild(fragment);
}

export function isCaretInsideMentionSpan(_root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const node = selection.getRangeAt(0).startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  return !!element?.closest(MENTION_SPAN_SELECTOR);
}

/**
 * 在光标处插入 `@` 并返回 mention 触发器（首页输入框 @ 按钮复用打字 @ 流程）。
 */
export function insertAtTriggerCharacter(root: HTMLElement): ActiveMentionTrigger | null {
  root.focus();
  const selection = window.getSelection();
  if (!selection) return null;

  let range: Range;
  if (selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
    range = selection.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }

  const atNode = document.createTextNode('@');
  range.insertNode(atNode);
  range.setStartAfter(atNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  return detectActiveMentionTrigger(root);
}
