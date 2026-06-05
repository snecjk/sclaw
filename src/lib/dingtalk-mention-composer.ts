import type { DingTalkMention } from '@/types/dingtalk-mention';

export const MENTION_SPAN_CLASS = 'dingtalk-mention-token';
export const MENTION_SPAN_SELECTOR = `span.${MENTION_SPAN_CLASS}`;

export interface MentionComposerSnapshot {
  plainText: string;
  mentions: DingTalkMention[];
  isEmpty: boolean;
}

export interface ActiveMentionTrigger {
  query: string;
  /** Plain-text start offset of `@`, inclusive. */
  startOffset: number;
  /** Plain-text end offset of caret, exclusive. */
  endOffset: number;
}

function isMentionSpan(node: Node | null): node is HTMLSpanElement {
  return node instanceof HTMLSpanElement && node.classList.contains(MENTION_SPAN_CLASS);
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

    const element = node as HTMLElement;
    if (element.tagName === 'BR') {
      plainText += '\n';
      return;
    }

    element.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);
  const normalized = plainText.replace(/\u00A0/g, ' ');
  return {
    plainText: normalized,
    mentions,
    isEmpty: normalized.trim().length === 0 && mentions.length === 0,
  };
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

    if (node instanceof HTMLElement && isMentionSpan(node)) {
      const text = node.textContent ?? '';
      const next = current + text.length;
      if (targetOffset <= next) {
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

export function createMentionSpan(mention: DingTalkMention): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = [
    MENTION_SPAN_CLASS,
    'inline',
    'rounded-[3px]',
    'bg-[#E8F3FF]',
    'px-0.5',
    'text-[#1677FF]',
    'font-medium',
    'dark:bg-[#1677FF]/15',
    'dark:text-[#4C9BFF]',
  ].join(' ');
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
  span.textContent = `@${mention.displayName}`;
  return span;
}

export function insertMentionAtTrigger(
  root: HTMLElement,
  trigger: ActiveMentionTrigger,
  mention: DingTalkMention,
): void {
  const selection = window.getSelection();
  const triggerRange = buildRangeFromPlainTextOffsets(root, trigger.startOffset, trigger.endOffset);
  if (!triggerRange) return;
  triggerRange.deleteContents();

  const mentionSpan = createMentionSpan(mention);
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

export function removeMentionBeforeCaret(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;

  const { startContainer, startOffset } = range;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = startContainer as Text;
    const prev = textNode.previousSibling;
    if (isMentionSpan(prev)) {
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
    if (isMentionSpan(prev)) {
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

export function isCaretInsideMentionSpan(_root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const node = selection.getRangeAt(0).startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  return !!element?.closest(MENTION_SPAN_SELECTOR);
}
