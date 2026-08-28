import type { FileProvenance } from '@/components/attachments/types';
import {
  ATTACHMENT_CHIP_SURFACE_CLASS,
  middleEllipsisFileName,
  resolveFileTypeIconSrc,
} from '@/components/attachments/file-type-icon';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { saiInterfaceComposerTagClass, skillComposerTagClass } from '@/lib/surfaces';

export const MENTION_SPAN_CLASS = 'dingtalk-mention-token';
export const MENTION_SPAN_SELECTOR = `span.${MENTION_SPAN_CLASS}`;

export const WORKFLOW_SPAN_CLASS = 'workflow-token';
export const WORKFLOW_SPAN_SELECTOR = `span.${WORKFLOW_SPAN_CLASS}`;

export const SKILL_SPAN_CLASS = 'skill-token';
export const SKILL_SPAN_SELECTOR = `span.${SKILL_SPAN_CLASS}`;

export const SAI_INTERFACE_SPAN_CLASS = 'sai-interface-token';
export const SAI_INTERFACE_SPAN_SELECTOR = `span.${SAI_INTERFACE_SPAN_CLASS}`;

export const ATTACHMENT_SPAN_CLASS = 'attachment-token';
export const ATTACHMENT_SPAN_SELECTOR = `span.${ATTACHMENT_SPAN_CLASS}`;

export type ComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; mention: DingTalkMention }
  | { type: 'skill'; slug: string; title: string }
  | { type: 'workflow'; id: string; name: string; source?: string }
  | { type: 'file'; attachmentId: string };

/** 乐观消息 / 编辑草稿往返持久化的 segment（文件节点含行内元数据）。 */
export type PersistedComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; mention: DingTalkMention }
  | { type: 'skill'; slug: string; title: string }
  | { type: 'workflow'; id: string; name: string; source?: string }
  | {
    type: 'file';
    fileName: string;
    mimeType: string;
    fileSize: number;
    preview: string | null;
    filePath?: string;
    stagedPath?: string;
    provenance?: FileProvenance;
  };

export const EMPTY_MENTION_COMPOSER_SNAPSHOT: MentionComposerSnapshot = {
  plainText: '',
  segments: [],
  mentions: [],
  skills: [],
  workflows: [],
  attachmentIds: [],
  isEmpty: true,
};

export interface ComposerWorkflowMeta {
  id: string;
  name: string;
  source?: string;
}

export interface MentionComposerSnapshot {
  plainText: string;
  segments: ComposerSegment[];
  mentions: DingTalkMention[];
  skills: SkillMeta[];
  workflows: ComposerWorkflowMeta[];
  attachmentIds: string[];
  isEmpty: boolean;
  /** @deprecated 兼容：等价 skills[0] */
  skill?: SkillMeta;
  /** @deprecated 兼容：skills[0] 对应 offset */
  skillOffset?: number;
  /** @deprecated 兼容：等价 workflows[0] */
  workflowId?: string;
  workflowName?: string;
  workflowSource?: string;
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

function isSaiInterfaceSpan(node: Node | null): boolean {
  return node instanceof HTMLSpanElement
    && (node.classList.contains(SAI_INTERFACE_SPAN_CLASS) || Boolean(node.dataset.saiPath));
}

function formatSaiInterfacePlainText(name: string, path: string): string {
  if (name && path) return `「${name}」(${path})`;
  return name || path;
}

export function isAttachmentSpan(node: Node | null): boolean {
  return node instanceof HTMLSpanElement
    && (node.classList.contains(ATTACHMENT_SPAN_CLASS) || Boolean(node.dataset.attachmentId));
}

function isInlineTokenSpan(node: Node | null): boolean {
  return isMentionSpan(node)
    || isWorkflowSpan(node)
    || isSkillSpan(node)
    || isAttachmentSpan(node)
    || isSaiInterfaceSpan(node);
}

function appendTextSegment(segments: ComposerSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.type === 'text') {
    last.text += text;
  } else {
    segments.push({ type: 'text', text });
  }
}

/** 文末 chip 后的光标/选区锚点：Chrome 在 contenteditable=false 作为最后节点时无法点选。 */
const COMPOSER_CARET_ANCHOR = '\u200B';

function stripComposerCaretAnchor(text: string): string {
  return text.replace(/\u200B/g, '');
}

/** 最后一个 inline chip 后面必须有可落点的文本，否则文末 @/工作流无法点选。 */
export function ensureTrailingCaretAnchor(root: HTMLElement): void {
  const last = root.lastChild;
  if (!last || !isInlineTokenSpan(last)) return;
  root.appendChild(document.createTextNode(`\u00A0${COMPOSER_CARET_ANCHOR}`));
}

/** 把 segment / 纯文本里的 `\n` 还原成 `<br>`，避免 contenteditable 把换行压成空格。 */
function appendTextWithLineBreaks(parent: ParentNode, text: string): void {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized) return;
  const parts = normalized.split('\n');
  parts.forEach((part, index) => {
    if (index > 0) {
      parent.appendChild(document.createElement('br'));
    }
    if (part) {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function isEmptyEditorFillerNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').trim() === '';
  }
  return node instanceof HTMLBRElement;
}

function clearEmptyEditorFillers(root: HTMLElement): void {
  if (root.childNodes.length === 0) return;
  if (!Array.from(root.childNodes).every(isEmptyEditorFillerNode)) return;
  root.replaceChildren();
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

export function readAttachmentIdFromSpan(span: HTMLSpanElement): string | null {
  return span.dataset.attachmentId ?? null;
}

function isEditorBlockElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement
    && (node.tagName === 'DIV' || node.tagName === 'P');
}

/** 浏览器空行占位：`<div><br></div>` 仅靠块间 `\n` 表达，不再重复计入 BR。 */
function isSolitaryEmptyBlockFiller(block: HTMLElement): boolean {
  const kids = Array.from(block.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').length > 0;
    }
    return true;
  });
  return kids.length === 1 && kids[0] instanceof HTMLBRElement;
}

export function serializeMentionEditor(root: HTMLElement): MentionComposerSnapshot {
  const segments: ComposerSegment[] = [];
  const mentions: DingTalkMention[] = [];
  const skills: SkillMeta[] = [];
  const skillOffsets: number[] = [];
  const workflows: ComposerWorkflowMeta[] = [];
  const attachmentIds: string[] = [];
  let plainText = '';

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = stripComposerCaretAnchor(node.textContent ?? '');
      if (!text) return;
      plainText += text;
      appendTextSegment(segments, text);
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    if (isMentionSpan(node)) {
      const mention = readMentionFromSpan(node);
      if (mention) {
        mentions.push(mention);
        const mentionText = `@${mention.displayName}`;
        plainText += mentionText;
        segments.push({ type: 'mention', mention });
      }
      return;
    }

    if (isSkillSpan(node)) {
      const parsed = readSkillFromSpan(node);
      if (parsed) {
        skills.push(parsed);
        skillOffsets.push(plainText.length);
        segments.push({ type: 'skill', slug: parsed.slug, title: parsed.title });
      }
      return;
    }

    if (isSaiInterfaceSpan(node)) {
      const span = node as HTMLSpanElement;
      const name = span.dataset.saiName ?? span.textContent?.trim() ?? '';
      const path = span.dataset.saiPath ?? '';
      plainText += formatSaiInterfacePlainText(name, path);
      return;
    }

    if (isWorkflowSpan(node)) {
      const span = node as HTMLSpanElement;
      const id = span.dataset.workflowId;
      const name = span.dataset.workflowName ?? span.querySelector('.workflow-token-label')?.textContent?.trim() ?? span.textContent ?? '';
      if (id) {
        workflows.push({
          id,
          name,
          source: span.dataset.workflowSource,
        });
        segments.push({
          type: 'workflow',
          id,
          name,
          source: span.dataset.workflowSource,
        });
      }
      plainText += name;
      return;
    }

    if (isAttachmentSpan(node)) {
      const attachmentId = readAttachmentIdFromSpan(node);
      if (attachmentId) {
        attachmentIds.push(attachmentId);
        segments.push({ type: 'file', attachmentId });
      }
      return;
    }

    const element = node as HTMLElement;
    if (element.tagName === 'BR') {
      plainText += '\n';
      appendTextSegment(segments, '\n');
      return;
    }

    element.childNodes.forEach(walk);
  };

  const rootChildren = Array.from(root.childNodes);
  const hasBlockChildren = rootChildren.some(isEditorBlockElement);
  if (hasBlockChildren) {
    // contenteditable 回车常生成块级 DIV。
    // 先插入 chip 再打字时，首段会留在根上（inline），后续行才是 DIV；
    // 不能只在「块与块之间」补 `\n`，否则第一个 DIV 前的换行会丢光。
    let emittedBlocks = 0;
    let emittedInline = false;
    for (const child of rootChildren) {
      if (isEditorBlockElement(child)) {
        if (emittedBlocks > 0 || emittedInline) {
          plainText += '\n';
          appendTextSegment(segments, '\n');
        }
        emittedBlocks += 1;
        if (isSolitaryEmptyBlockFiller(child)) {
          continue;
        }
        child.childNodes.forEach(walk);
        continue;
      }
      walk(child);
      emittedInline = true;
    }
  } else {
    rootChildren.forEach(walk);
  }

  if (skills.length === 0) {
    const skillSpan = root.querySelector(SKILL_SPAN_SELECTOR)
      ?? root.querySelector('span[data-skill-slug]');
    if (skillSpan instanceof HTMLSpanElement) {
      const parsed = readSkillFromSpan(skillSpan);
      if (parsed) {
        skills.push(parsed);
        skillOffsets.push(0);
        segments.unshift({ type: 'skill', slug: parsed.slug, title: parsed.title });
      }
    }
  }

  let normalized = plainText.replace(/\u00A0/g, ' ');
  const startsWithInlineToken = composerStartsWithInlineToken(segments);
  // 首个 inline token 在最前时，它自带的分隔空格不应留在正文里。
  // 注意：file 后再跟 skill 时 skillOffset 往往是中间 NBSP 长度（>0），仍必须剥前导空白，
  // 否则与 findPlainTextBoundary 的跳过策略错位，insertMentionAtTrigger 会静默失败。
  if (startsWithInlineToken) {
    // 只剥 chip 自带的行内分隔空格，不能用 \s 连换行一起吃掉。
    const trimmed = normalized.replace(/^[ \t\u00A0]+/, '');
    const lead = normalized.length - trimmed.length;
    if (lead > 0) {
      normalized = trimmed;
      for (let i = 0; i < skillOffsets.length; i += 1) {
        skillOffsets[i] = Math.max(0, skillOffsets[i] - lead);
      }
      for (const seg of segments) {
        if (seg.type === 'text') {
          seg.text = seg.text.replace(/^[ \t\u00A0]+/, '').replace(/\u00A0/g, ' ');
          break;
        }
      }
    }
  }

  const skill = skills[0];
  const skillOffset = skill
    ? Math.min(skillOffsets[0] ?? 0, normalized.length)
    : undefined;
  const firstWorkflow = workflows[0];

  const cleanSkills = skills.map(({ slug, title }) => ({ slug, title }));

  return {
    plainText: normalized,
    segments,
    mentions,
    skills: cleanSkills,
    workflows,
    attachmentIds,
    skill,
    skillOffset,
    workflowId: firstWorkflow?.id,
    workflowName: firstWorkflow?.name,
    workflowSource: firstWorkflow?.source,
    isEmpty: normalized.trim().length === 0
      && mentions.length === 0
      && cleanSkills.length === 0
      && workflows.length === 0
      && attachmentIds.length === 0,
  };
}

/**
 * 把 snapshot 的技能偏移换算到 `plainText.trim()` 之后的坐标系。
 * 发送链路统一用 trim 后的文本作为气泡正文，偏移必须同步左移并夹在文本范围内。
 */
export function resolveTrimmedSkillOffset(
  plainText: string,
  skillOffset: number | undefined,
): number | undefined {
  if (skillOffset === undefined) return undefined;
  const leadingWhitespace = plainText.length - plainText.replace(/^\s+/, '').length;
  const trimmedLength = plainText.trim().length;
  return Math.min(Math.max(skillOffset - leadingWhitespace, 0), trimmedLength);
}

/**
 * 从 plainText 提取触发符后的内联筛选关键词。
 * `caretOffset` 有值时只看光标之前的文本（避免中间插入 `/`/`*` 时把后续正文当成 filter）。
 * 省略时等同于光标在文末（兼容旧调用）。
 */
function extractInlineTriggerQuery(
  plainText: string,
  triggerChar: '/' | '*',
  caretOffset?: number | null,
): string {
  const end = typeof caretOffset === 'number'
    ? Math.max(0, Math.min(caretOffset, plainText.length))
    : plainText.length;
  const beforeCaret = plainText.slice(0, end);
  const idx = beforeCaret.lastIndexOf(triggerChar);
  if (idx === -1) return '';
  return beforeCaret.slice(idx + 1);
}

/** 从 plainText 提取 `*` 之后的内联筛选关键词（composer 技能 Picker inline 模式）。 */
export function extractSkillInlineQuery(plainText: string, caretOffset?: number | null): string {
  return extractInlineTriggerQuery(plainText, '*', caretOffset);
}

/** 从 plainText 提取 `/` 之后的工作流/技能筛选关键词（composer slash Picker）。 */
export function extractSlashInlineQuery(plainText: string, caretOffset?: number | null): string {
  return extractInlineTriggerQuery(plainText, '/', caretOffset);
}

/** plainText 中是否包含技能 inline 触发符 `*`。 */
export function hasSkillInlineTrigger(plainText: string): boolean {
  return plainText.includes('*');
}

/**
 * 在 plainText 中定位触发符：优先光标前最近的触发符，且其后到光标的文本等于 query。
 * 失焦时用 `${trigger}${query}` 从后往前找，避免误删光标后的正文。
 */
function findInlineTriggerStart(
  plainText: string,
  triggerChar: '/' | '*',
  query: string,
  caretOffset?: number | null,
): number {
  if (typeof caretOffset === 'number') {
    const end = Math.max(0, Math.min(caretOffset, plainText.length));
    const beforeCaret = plainText.slice(0, end);
    const idx = beforeCaret.lastIndexOf(triggerChar);
    if (idx !== -1 && beforeCaret.slice(idx + 1) === query) {
      return idx;
    }
  }
  const needle = `${triggerChar}${query}`;
  const fromNeedle = plainText.lastIndexOf(needle);
  if (fromNeedle !== -1) return fromNeedle;
  return plainText.lastIndexOf(triggerChar);
}

/**
 * 移除 editor 中触发符及其后的内联筛选文本，并把光标停在原触发位置。
 * @returns 触发符在 plainText 中的起始下标；未找到时返回 null
 */
function consumeTriggerTextAt(
  root: HTMLElement,
  triggerChar: '/' | '*',
  explicitQuery: string | undefined,
  extractQuery: (plainText: string, caretOffset?: number | null) => string,
  caretOffset?: number | null,
): number | null {
  const plainText = serializeMentionEditor(root).plainText;
  const caret = caretOffset ?? readCaretPlainTextOffset(root);
  const query = explicitQuery ?? extractQuery(plainText, caret);
  const startIdx = findInlineTriggerStart(plainText, triggerChar, query, caret);
  if (startIdx === -1) return null;

  const endIdx = startIdx + 1 + query.length;

  const range = buildRangeFromPlainTextOffsets(root, startIdx, endIdx);
  if (!range) return null;

  range.deleteContents();
  // deleteContents 后 range 折叠在删除点；写回 Selection，避免点选浮层失焦后落点漂到开头。
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return startIdx;
}

/**
 * 移除 editor 中 `*` 及其后的内联筛选文本（选中技能或取消 inline Picker 时调用）。
 * @param explicitQuery 选中技能时传入当前 filter，避免误删 `*` 之后用户已输入的正文
 * @param caretOffset 可选；失焦选中时传入上次保存的光标，避免误定位到文末触发符
 * @returns 触发位置下标；未找到时返回 null
 */
export function consumeSkillTriggerText(
  root: HTMLElement,
  explicitQuery?: string,
  caretOffset?: number | null,
): number | null {
  return consumeTriggerTextAt(root, '*', explicitQuery, extractSkillInlineQuery, caretOffset);
}

/**
 * 移除 editor 中 `/` 及其后的内联筛选文本（slash 组合浮层选中时调用）。
 * @param caretOffset 可选；失焦选中时传入上次保存的光标
 * @returns `/` 在 plainText 中的起始下标；未找到时返回 null
 */
export function consumeSlashTriggerText(
  root: HTMLElement,
  explicitQuery?: string,
  caretOffset?: number | null,
): number | null {
  return consumeTriggerTextAt(root, '/', explicitQuery, extractSlashInlineQuery, caretOffset);
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

/** 读取当前折叠光标在 plainText 坐标系中的下标；光标不在 editor 内时返回 null。 */
export function readCaretPlainTextOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return null;
  if (!root.contains(range.startContainer)) return null;
  return collectTextBeforeCaret(root, range).length;
}

interface PlainTextBoundary {
  node: Node;
  offset: number;
}

function composerStartsWithInlineToken(segments: ComposerSegment[]): boolean {
  const first = segments[0]?.type;
  return first === 'file'
    || first === 'skill'
    || first === 'workflow'
    || first === 'mention';
}

function findPlainTextBoundary(root: HTMLElement, targetOffset: number): PlainTextBoundary | null {
  let current = 0;
  // 与 serializeMentionEditor 一致：首个 inline token 在最前时 plainText 会剥掉它后面的空白，
  // 偏移映射也必须跳过，否则 insertMentionAtTrigger 会删错字符留下多余 @。
  const editorSnapshot = serializeMentionEditor(root);
  let skippingLeadingWs = composerStartsWithInlineToken(editorSnapshot.segments);

  const visit = (node: Node): PlainTextBoundary | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const data = textNode.data ?? '';
      // 真实下标映射：ZWSP 不计入 plainText，但 range offset 必须落在真实 DOM 上
      const realIndexByPlain: number[] = [];
      let stillSkippingLead = skippingLeadingWs;
      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i]!;
        if (ch === '\u200B') continue;
        const plainCh = ch === '\u00A0' ? ' ' : ch;
        if (stillSkippingLead && /[ \t]/.test(plainCh)) continue;
        if (stillSkippingLead) {
          stillSkippingLead = false;
          skippingLeadingWs = false;
        }
        realIndexByPlain.push(i);
      }
      if (realIndexByPlain.length === 0) {
        return null;
      }

      const next = current + realIndexByPlain.length;
      if (targetOffset <= next) {
        const plainOffsetInNode = targetOffset - current;
        if (plainOffsetInNode >= realIndexByPlain.length) {
          const lastReal = realIndexByPlain[realIndexByPlain.length - 1]!;
          return { node: textNode, offset: lastReal + 1 };
        }
        return { node: textNode, offset: realIndexByPlain[plainOffsetInNode]! };
      }
      current = next;
      return null;
    }

    if (
      node instanceof HTMLElement
      && (isMentionSpan(node) || isWorkflowSpan(node) || isSkillSpan(node) || isAttachmentSpan(node) || isSaiInterfaceSpan(node))
    ) {
      if (isSkillSpan(node) || isAttachmentSpan(node)) {
        return null;
      }
      skippingLeadingWs = false;
      // 与 serializeMentionEditor 保持一致：mention span 用 `@displayName`
      // （不含 removable 模式下 × 删除按钮的字符），否则偏移量会与序列化错位。
      const text = isMentionSpan(node)
        ? `@${node.dataset.mentionName ?? ''}`
        : isSaiInterfaceSpan(node)
          ? formatSaiInterfacePlainText(
            node.dataset.saiName ?? node.textContent?.trim() ?? '',
            node.dataset.saiPath ?? '',
          )
          : (node.dataset.workflowName ?? node.textContent ?? '');
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
        skippingLeadingWs = false;
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

  // 紧贴最后一个 chip 之后 / 全文末尾：visit 只推进 current 不返回边界，这里补上
  if (targetOffset === current) {
    return boundaryAtEditorEnd(root);
  }

  return null;
}

function boundaryAtEditorEnd(root: HTMLElement): PlainTextBoundary {
  let lastText: Text | null = null;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (stripComposerCaretAnchor(node.textContent ?? '').length > 0) {
        lastText = node as Text;
      }
      return;
    }
    if (node instanceof HTMLElement) {
      if (isInlineTokenSpan(node)) return;
      node.childNodes.forEach(walk);
    }
  };
  root.childNodes.forEach(walk);
  if (lastText) {
    return { node: lastText, offset: lastText.data.length };
  }
  return { node: root, offset: root.childNodes.length };
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
    ? `${MENTION_SPAN_BASE_CLASS} inline-flex items-center gap-0.5 px-1 py-px select-all`
    : `${MENTION_SPAN_BASE_CLASS} inline px-0.5 select-all`;
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
    'inline-flex',
    'items-center',
    'gap-0.5',
    'rounded-[4px]',
    'bg-[#EEF3FF]',
    'px-1',
    'py-0.5',
    'align-middle',
    'text-[12px]',
    'font-medium',
    'leading-4',
    'text-[#4E6FFF]',
  ].join(' ');
  span.contentEditable = 'false';
  span.dataset.workflowId = workflowId;
  span.dataset.workflowName = name;
  if (source) span.dataset.workflowSource = source;

  const icon = document.createElement('span');
  icon.className = 'workflow-token-icon inline-flex h-3 w-3 shrink-0';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 4.5V2.5C1.5 1.94772 1.94772 1.5 2.5 1.5H4.5C5.05228 1.5 5.5 1.94772 5.5 2.5V4.5C5.5 5.05228 5.05228 5.5 4.5 5.5H2.5C1.94772 5.5 1.5 5.05228 1.5 4.5Z" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 5.5V7.5C3.5 8.05228 3.94772 8.5 4.5 8.5H6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6.5 9.5V7.5C6.5 6.94772 6.94772 6.5 7.5 6.5H9.5C10.0523 6.5 10.5 6.94772 10.5 7.5V9.5C10.5 10.0523 10.0523 10.5 9.5 10.5H7.5C6.94772 10.5 6.5 10.0523 6.5 9.5Z" stroke="currentColor" stroke-width="1.2"/></svg>';

  const label = document.createElement('span');
  label.className = 'workflow-token-label';
  label.textContent = name;

  span.append(icon, label);
  return span;
}

const ATTACHMENT_SPAN_BASE_CLASS = [
  ATTACHMENT_SPAN_CLASS,
  ATTACHMENT_CHIP_SURFACE_CLASS,
].join(' ');

const ATTACHMENT_REMOVE_BTN_CLASS = [
  'attachment-remove-btn',
  'inline-flex',
  'h-3.5',
  'w-3.5',
  'shrink-0',
  'items-center',
  'justify-center',
  'rounded-full',
  'text-[11px]',
  'leading-none',
  'text-[#86909C]',
  'transition-colors',
  'hover:bg-black/5',
  'hover:text-[#1D2129]',
].join(' ');

export interface AttachmentSpanInput {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  status?: 'staging' | 'ready' | 'error';
  preview?: string | null;
}

export function createAttachmentSpan(att: AttachmentSpanInput): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = ATTACHMENT_SPAN_BASE_CLASS;
  span.contentEditable = 'false';
  span.dataset.attachmentId = att.id;
  span.dataset.fileName = att.fileName;
  span.dataset.mimeType = att.mimeType;
  if (att.fileSize !== undefined) span.dataset.fileSize = String(att.fileSize);
  if (att.status) span.dataset.status = att.status;
  span.title = att.fileName;

  const icon = document.createElement('img');
  icon.className = 'attachment-token-icon h-4 w-4 shrink-0 object-contain';
  icon.src = resolveFileTypeIconSrc(att.fileName, att.mimeType);
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  icon.draggable = false;

  const label = document.createElement('span');
  label.className = 'attachment-token-label min-w-0 flex-1 truncate whitespace-nowrap';
  label.textContent = middleEllipsisFileName(att.fileName);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.dataset.attachmentRemove = 'true';
  removeBtn.setAttribute('aria-label', '移除附件');
  removeBtn.className = ATTACHMENT_REMOVE_BTN_CLASS;
  removeBtn.textContent = '×';

  span.append(icon, label, removeBtn);
  return span;
}

function removeInlineTokenTrailingSpace(token: HTMLSpanElement): void {
  const next = token.nextSibling;
  token.remove();
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next.textContent ?? '';
    if (text === '\u00A0' || text === ' ') {
      next.remove();
    }
  }
}

export function removeAttachmentSpan(root: HTMLElement, attachmentId: string): void {
  const existing = root.querySelector(`${ATTACHMENT_SPAN_SELECTOR}[data-attachment-id="${CSS.escape(attachmentId)}"]`);
  if (!(existing instanceof HTMLSpanElement)) return;
  removeInlineTokenTrailingSpace(existing);
}

export function updateAttachmentSpanStatus(
  root: HTMLElement,
  attachmentId: string,
  status: 'staging' | 'ready' | 'error',
  extras?: { stagedPath?: string; error?: string },
): void {
  const existing = root.querySelector(`${ATTACHMENT_SPAN_SELECTOR}[data-attachment-id="${CSS.escape(attachmentId)}"]`);
  if (!(existing instanceof HTMLSpanElement)) return;
  existing.dataset.status = status;
  if (extras?.stagedPath) existing.dataset.stagedPath = extras.stagedPath;
  if (extras?.error) existing.dataset.error = extras.error;
  existing.classList.toggle('opacity-60', status === 'staging');
  existing.classList.toggle('text-destructive', status === 'error');
}

export function insertAttachmentSpan(
  root: HTMLElement,
  att: AttachmentSpanInput,
  plainTextOffset?: number,
): void {
  clearEmptyEditorFillers(root);
  if (plainTextOffset !== undefined) {
    moveCaretToPlainTextOffset(root, plainTextOffset);
  }
  insertTokenAtCaret(root, createAttachmentSpan(att));
}

export interface AttachmentLookupEntry {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  status?: string;
  preview?: string | null;
}

export function setMentionEditorSegments(
  root: HTMLElement,
  segments: ComposerSegment[],
  attachmentsById?: Record<string, AttachmentLookupEntry>,
): void {
  root.innerHTML = '';
  if (segments.length === 0) return;

  const fragment = document.createDocumentFragment();
  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        appendTextWithLineBreaks(fragment, seg.text);
        break;
      case 'mention':
        fragment.appendChild(createMentionSpan(seg.mention));
        fragment.appendChild(document.createTextNode('\u00A0'));
        break;
      case 'skill':
        fragment.appendChild(createSkillSpan(seg.slug, seg.title));
        fragment.appendChild(document.createTextNode('\u00A0'));
        break;
      case 'workflow':
        fragment.appendChild(createWorkflowSpan(seg.id, seg.name, seg.source));
        fragment.appendChild(document.createTextNode('\u00A0'));
        break;
      case 'file': {
        const att = attachmentsById?.[seg.attachmentId];
        if (!att) break;
        fragment.appendChild(createAttachmentSpan({
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          status: att.status as AttachmentSpanInput['status'],
          preview: att.preview,
        }));
        fragment.appendChild(document.createTextNode('\u00A0'));
        break;
      }
      default:
        break;
    }
  }
  root.appendChild(fragment);
  ensureTrailingCaretAnchor(root);
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

export function createSaiInterfaceSpan(path: string, name: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = saiInterfaceComposerTagClass;
  span.contentEditable = 'false';
  span.dataset.saiPath = path;
  span.dataset.saiName = name;
  span.title = path;
  span.textContent = name;
  return span;
}

/**
 * Insert a sai-cli interface chip at the caret (supports multiple).
 * `preferredRange` restores caret after picker clicks steal focus.
 */
export function insertSaiInterfaceSpan(
  root: HTMLElement,
  path: string,
  name: string,
  preferredRange?: Range | null,
): void {
  const selection = window.getSelection();
  root.focus();

  let range: Range | null = null;
  if (preferredRange && root.contains(preferredRange.startContainer)) {
    range = preferredRange.cloneRange();
  } else if (
    selection
    && selection.rangeCount > 0
    && selection.anchorNode
    && root.contains(selection.anchorNode)
  ) {
    range = selection.getRangeAt(0).cloneRange();
  } else {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.deleteContents();
  const span = createSaiInterfaceSpan(path, name);
  const space = document.createTextNode('\u00A0');
  const fragment = document.createDocumentFragment();
  fragment.append(span, space);
  range.insertNode(fragment);

  const caretRange = document.createRange();
  caretRange.setStart(space, 1);
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
}

export function removeWorkflowSpan(root: HTMLElement): void {
  const existing = root.querySelector(WORKFLOW_SPAN_SELECTOR);
  if (!(existing instanceof HTMLSpanElement)) return;
  removeInlineTokenTrailingSpace(existing);
}

export function removeSkillSpan(root: HTMLElement): void {
  const existing = root.querySelector(SKILL_SPAN_SELECTOR);
  if (!(existing instanceof HTMLSpanElement)) return;
  removeInlineTokenTrailingSpace(existing);
}

/** 当前光标位置；光标不在编辑器内时退回到内容末尾。 */
function resolveCaretRange(root: HTMLElement): Range {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (root.contains(range.startContainer) && root.contains(range.endContainer)) {
      return range.cloneRange();
    }
  }
  const fallback = document.createRange();
  fallback.selectNodeContents(root);
  fallback.collapse(false);
  return fallback;
}

/** 在光标处插入 token 与其分隔空格，并把光标停在空格之后。 */
function insertTokenAtCaret(root: HTMLElement, span: HTMLSpanElement): void {
  const space = document.createTextNode('\u00A0');
  const range = resolveCaretRange(root);
  range.deleteContents();

  // 回车后 Chrome 行是 `<div>你好<br></div>`。insertNode 会把 chip 拆到 BR 后/下一 DIV。
  // 插在 trailing BR 前面，chip 与「你好」同一行。无 BR 的首行/会话保持原 insertNode。
  const trailingBr = findTrailingBreakAfterCaret(range);
  if (trailingBr?.parentNode) {
    trailingBr.parentNode.insertBefore(span, trailingBr);
    trailingBr.parentNode.insertBefore(space, trailingBr);
  } else {
    const fragment = document.createDocumentFragment();
    fragment.append(span, space);
    range.insertNode(fragment);
  }

  mergeTokenIfSplitIntoNextBlock(root, span);

  const caretRange = document.createRange();
  caretRange.setStart(space, space.length);
  caretRange.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
  ensureTrailingCaretAnchor(root);
}

/** 光标落在「文本末尾 + 行尾 BR」时，返回这个 BR。 */
function findTrailingBreakAfterCaret(range: Range): HTMLBRElement | null {
  const { startContainer, startOffset } = range;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = startContainer as Text;
    if (startOffset < textNode.data.length) return null;
    const next = textNode.nextSibling;
    return next instanceof HTMLBRElement ? next : null;
  }
  if (startContainer instanceof HTMLElement) {
    const node = startContainer.childNodes[startOffset] ?? null;
    return node instanceof HTMLBRElement ? node : null;
  }
  return null;
}

/**
 * Chrome 把 chip 拆进下一个 DIV、上一 DIV 又不带行尾 BR 时，贴回上一行。
 * 上一行以 BR 结尾说明用户已经换段，不合并。
 */
function mergeTokenIfSplitIntoNextBlock(root: HTMLElement, span: HTMLSpanElement): void {
  const parent = span.parentElement;
  if (!parent || parent === root || !isEditorBlockElement(parent)) return;

  const beforeHasText = Array.from(parent.childNodes).some((node) => {
    if (node === span) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/[\u200B\u00A0\s]/g, '').length > 0;
    }
    return isInlineTokenSpan(node);
  });
  if (beforeHasText) return;

  const prev = parent.previousSibling;
  if (!prev || !isEditorBlockElement(prev)) return;
  if (blockEndsWithLineBreak(prev)) return;

  while (parent.firstChild) {
    prev.appendChild(parent.firstChild);
  }
  parent.remove();
}

function blockEndsWithLineBreak(block: HTMLElement): boolean {
  let last: ChildNode | null = block.lastChild;
  while (
    last
    && last.nodeType === Node.TEXT_NODE
    && (last.textContent ?? '').replace(/[\u200B]/g, '').length === 0
  ) {
    last = last.previousSibling;
  }
  return last instanceof HTMLBRElement;
}

/** 任务描述 Enter 插入 `<br>`，避免 Chrome 生成 DIV 把下一行 chip 拆下去。会话仍走默认换段。 */
export function insertLineBreakAtCaret(root: HTMLElement): void {
  const range = resolveCaretRange(root);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  if (!br.nextSibling) {
    const anchor = document.createTextNode('\u200B');
    br.parentNode?.insertBefore(anchor, br.nextSibling);
  }
  const after = br.nextSibling;
  const caretRange = document.createRange();
  if (after?.nodeType === Node.TEXT_NODE) {
    caretRange.setStart(after, 0);
  } else {
    caretRange.setStartAfter(br);
  }
  caretRange.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
}

/** 把光标移到 plainText 的指定下标；映射失败时保持原光标。 */
function moveCaretToPlainTextOffset(root: HTMLElement, offset: number): void {
  const range = buildRangeFromPlainTextOffsets(root, offset, offset);
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * @param plainTextOffset 指定落点（编辑重发还原时使用）；缺省则插在当前光标处。
 */
export function insertSkillSpan(
  root: HTMLElement,
  slug: string,
  title: string,
  plainTextOffset?: number,
): void {
  clearEmptyEditorFillers(root);
  if (plainTextOffset !== undefined) {
    moveCaretToPlainTextOffset(root, plainTextOffset);
  }
  insertTokenAtCaret(root, createSkillSpan(slug, title));
}

/** Relabel a rendered skill token in place, so the caret and surrounding text survive. */
export function retitleSkillSpan(root: HTMLElement, slug: string, title: string): boolean {
  const span = root.querySelector(SKILL_SPAN_SELECTOR)
    ?? root.querySelector('span[data-skill-slug]');
  if (!(span instanceof HTMLSpanElement)) return false;
  if (span.dataset.skillSlug !== slug || span.dataset.skillTitle === title) return false;

  span.dataset.skillTitle = title;
  const label = span.querySelector('.skill-token-label');
  if (label) label.textContent = title;
  return true;
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
  let triggerRange = buildRangeFromPlainTextOffsets(root, trigger.startOffset, trigger.endOffset);
  if (!triggerRange) {
    // 文末 @ 在 Chrome 里偏移常映射失败，回退到 DOM 里定位 `@query`
    triggerRange = findMentionTriggerRangeInDom(root, trigger);
  }
  if (!triggerRange) return;
  triggerRange.deleteContents();

  const mentionSpan = createMentionSpan(mention, options);
  const space = document.createTextNode('\u00A0');
  const fragment = document.createDocumentFragment();
  fragment.append(mentionSpan, space);
  triggerRange.insertNode(fragment);

  if (mentionSpan.previousSibling instanceof HTMLBRElement) {
    mentionSpan.previousSibling.remove();
  }

  const caretRange = document.createRange();
  caretRange.setStart(space, 1);
  caretRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caretRange);
  root.focus();
  ensureTrailingCaretAnchor(root);
}

/** 在文本节点里从后往前找 `@query`，供文末 insertMention 偏移失败时兜底。 */
function findMentionTriggerRangeInDom(
  root: HTMLElement,
  trigger: ActiveMentionTrigger,
): Range | null {
  const texts: Text[] = [];
  const collect = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      texts.push(node as Text);
      return;
    }
    if (node instanceof HTMLElement && !isInlineTokenSpan(node)) {
      node.childNodes.forEach(collect);
    }
  };
  root.childNodes.forEach(collect);

  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const node = texts[i]!;
    const data = node.data ?? '';
    const atIdx = data.lastIndexOf('@');
    if (atIdx < 0) continue;
    const after = data.slice(atIdx + 1);
    const matched = after.match(/^([^\s@\n]*)/);
    const query = matched?.[1] ?? '';
    if (trigger.query && query !== trigger.query && !query.startsWith(trigger.query) && !trigger.query.startsWith(query)) {
      continue;
    }
    const range = document.createRange();
    try {
      range.setStart(node, atIdx);
      range.setEnd(node, atIdx + 1 + query.length);
      return range;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * @param plainTextOffset 指定落点（slash 选中后使用）；缺省则插在当前光标处。
 */
export function insertWorkflowSpan(
  root: HTMLElement,
  workflowId: string,
  name: string,
  source?: string,
  plainTextOffset?: number,
): void {
  clearEmptyEditorFillers(root);
  if (plainTextOffset !== undefined) {
    moveCaretToPlainTextOffset(root, plainTextOffset);
  }
  insertTokenAtCaret(root, createWorkflowSpan(workflowId, name, source));
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
    if (prev && isInlineTokenSpan(prev)) {
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
    if (isInlineTokenSpan(prev)) {
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
  root.replaceChildren();
  appendTextWithLineBreaks(root, text);
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
  ensureTrailingCaretAnchor(root);
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
