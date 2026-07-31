import type { RawMessage } from '@/stores/chat';
import type { ChatWorkflowCardRef } from '@/types/workflow';
import { isStableToolId } from '@/lib/thinking-timeline-active';
import {
  extractText,
  extractThinkingTimeline,
  isHiddenWorkflowCompleteUserMessage,
  isHiddenDuplicateWorkflowPreambleAssistantMessage,
  isHiddenWorkflowParamsUserMessage,
  isWorkflowPreambleAssistantMessage,
  messageHasWorkflowCard,
  type ThinkingTimelineItem,
} from './message-utils';

export type ChatDisplayItem =
  | { type: 'single'; message: RawMessage; key: string }
  | { type: 'workflow-run'; card: ChatWorkflowCardRef; key: string }
  | {
      type: 'assistant-turn';
      messages: RawMessage[];
      toolResults: RawMessage[];
      precedingUserMessage?: RawMessage;
      key: string;
    };

function displayItemTimestamp(item: ChatDisplayItem): number {
  if (item.type === 'workflow-run') return Date.parse(item.card.startedAt) || 0;
  const value = item.type === 'single'
    ? item.message.timestamp
    : item.messages[0]?.timestamp ?? item.precedingUserMessage?.timestamp;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function resolveWorkflowCardNameFromAnchor(
  card: ChatWorkflowCardRef,
  items: ChatDisplayItem[],
): ChatWorkflowCardRef {
  if (!/^wf_[\w-]+$/i.test(card.title.trim()) || !card.anchorUserMessageId) return card;
  const anchor = items.find((item) => (
    item.type === 'single'
    && item.message.role === 'user'
    && item.message.id === card.anchorUserMessageId
  ));
  if (anchor?.type !== 'single') return card;

  const matchedName = extractText(anchor.message).match(/工作流\s*【([^】]+)】/)?.[1]?.trim();
  return matchedName ? { ...card, title: matchedName } : card;
}

export function mergeWorkflowCardsIntoDisplayItems(
  baseItems: ChatDisplayItem[],
  cards: ChatWorkflowCardRef[],
): ChatDisplayItem[] {
  const merged = [...baseItems];
  const sorted = [...cards].sort((left, right) => (
    (Date.parse(left.startedAt) || 0) - (Date.parse(right.startedAt) || 0)
    || left.runId.localeCompare(right.runId)
  ));

  for (const card of sorted) {
    if (merged.some((item) => item.type === 'workflow-run' && item.card.runId === card.runId)) continue;
    const displayCard = resolveWorkflowCardNameFromAnchor(card, baseItems);
    const cardItem: ChatDisplayItem = {
      type: 'workflow-run',
      card: displayCard,
      key: `workflow-run:${displayCard.runId}`,
    };
    let insertAt = -1;
    if (displayCard.anchorUserMessageId) {
      const userIndex = merged.findIndex((item) => (
        item.type === 'single'
        && item.message.role === 'user'
        && item.message.id === displayCard.anchorUserMessageId
      ));
      if (userIndex >= 0) {
        insertAt = userIndex + 1;
        while (insertAt < merged.length) {
          const item = merged[insertAt];
          if (item.type === 'single' && item.message.role === 'user') break;
          if (
            item.type === 'workflow-run'
            && item.card.anchorUserMessageId !== displayCard.anchorUserMessageId
          ) break;
          insertAt += 1;
        }
      }
    }
    if (insertAt < 0) {
      const startedAt = Date.parse(displayCard.startedAt) || 0;
      insertAt = merged.findIndex((item) => displayItemTimestamp(item) > startedAt);
      if (insertAt < 0) insertAt = merged.length;
    }
    merged.splice(insertAt, 0, cardItem);
  }
  return merged;
}

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.toLowerCase() : '';
}

export function isAssistantRole(role: unknown): boolean {
  const r = normalizeRole(role);
  return r === 'assistant' || r === '';
}

export function isThinkingOnlyAssistantMessage(message: RawMessage): boolean {
  if (!isAssistantRole(message.role)) return false;
  if (extractText(message).trim().length > 0) return false;
  return extractThinkingTimeline(message).length > 0;
}

function normalizeThinkingKey(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** Collapse streaming re-phrases and near-duplicate planning lines in thinking blocks. */
export function isRedundantThinking(prev: string, next: string): boolean {
  if (prev === next) return true;
  const a = normalizeThinkingKey(prev);
  const b = normalizeThinkingKey(next);
  if (!a || !b) return false;
  if (a === b) return true;

  const aTrim = prev.trim();
  const bTrim = next.trim();
  if (bTrim.startsWith(aTrim) || aTrim.startsWith(bTrim)) return true;
  const aCore = aTrim.replace(/[。！？；：,.!?;:]+$/u, '');
  const bCore = bTrim.replace(/[。！？；：,.!?;:]+$/u, '');
  if (aCore.length > 0 && (bTrim.startsWith(aCore) || bCore.startsWith(aCore) || aCore.startsWith(bCore))) {
    return true;
  }

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 20 && longer.includes(shorter)) return true;

  // Shared substantial substring (same planning sentence with edits).
  const minShared = Math.min(18, shorter.length);
  for (let start = 0; start <= shorter.length - minShared; start += 1) {
    const slice = shorter.slice(start, start + minShared);
    if (longer.includes(slice)) {
      const lengthDelta = Math.abs(a.length - b.length);
      if (lengthDelta <= Math.max(36, shorter.length * 0.55)) return true;
      break;
    }
  }

  // Same opening intent with minor rewording (common in qwen thinking streams).
  const intentPrefixLen = Math.min(12, shorter.length, longer.length);
  if (intentPrefixLen >= 10 && shorter.slice(0, intentPrefixLen) === longer.slice(0, intentPrefixLen)) {
    const lengthDelta = Math.abs(a.length - b.length);
    if (lengthDelta <= Math.max(36, shorter.length * 0.55)) return true;
  }

  return false;
}

function preferThinkingContent(a: string, b: string): string {
  return b.length >= a.length ? b : a;
}

function messageToolIds(message: RawMessage): string[] {
  return extractThinkingTimeline(message)
    .filter((item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool')
    .map((item) => item.id)
    .filter(Boolean);
}

function messageToolNames(message: RawMessage): string[] {
  return extractThinkingTimeline(message)
    .filter((item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool')
    .map((item) => item.name);
}

function sameToolIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

/** 同一 tool 轮次：id 集合相同，或 id 不稳定时按 name 顺序对齐 */
function sameToolRound(
  aIds: string[],
  aNames: string[],
  bIds: string[],
  bNames: string[],
): boolean {
  if (aIds.length === 0 || bIds.length === 0) return false;
  if (aIds.length !== bIds.length || aNames.length !== bNames.length) return false;
  if (sameToolIdSet(aIds, bIds)) return true;
  return aNames.every((name, index) => name === bNames[index]);
}

function toolRoundDedupKey(id: string, name: string): string {
  if (isStableToolId(id, name)) return id;
  return `weak:${name}`;
}

function findLastSameToolRoundIndex(
  picked: RawMessage[],
  toolIds: string[],
  toolNames: string[],
): number {
  for (let i = picked.length - 1; i >= 0; i -= 1) {
    const candidate = picked[i];
    if (!candidate) continue;
    const ids = messageToolIds(candidate);
    const names = messageToolNames(candidate);
    if (sameToolRound(ids, names, toolIds, toolNames)) return i;
  }
  return -1;
}

/**
 * Claude 流式 buffer 与已提交 assistant 快照工具集相同 → 用 buffer 覆盖，避免双份解析。
 */
export function shouldReplaceStreamSnapshot(last: RawMessage, stream: RawMessage): boolean {
  if (!isAssistantRole(last.role) || !isAssistantRole(stream.role)) return false;

  const lastToolIds = messageToolIds(last);
  const streamToolIds = messageToolIds(stream);
  if (
    streamToolIds.length > 0
    && lastToolIds.length > 0
    && sameToolRound(
      lastToolIds,
      messageToolNames(last),
      streamToolIds,
      messageToolNames(stream),
    )
  ) {
    return true;
  }

  // Claude Agent 流式：旁白 snapshot 先到达，随后同一 buffer 长出 tool → 覆盖旁白槽，避免双份 timeline
  if (streamToolIds.length > 0 && lastToolIds.length === 0) {
    const lastText = extractText(last).trim();
    if (lastText.length > 0 && !isThinkingOnlyAssistantMessage(last)) {
      return true;
    }
  }

  if (lastToolIds.length > 0 || streamToolIds.length > 0) return false;

  const lastText = extractText(last).trim();
  const streamText = extractText(stream).trim();
  if (!lastText && !streamText) return true;
  return (
    lastText.length > 0
    && streamText.length > 0
    && (streamText.startsWith(lastText) || lastText.startsWith(streamText))
  );
}

/**
 * Streaming turns append many assistant snapshots that only rephrase thinking.
 * Keep snapshots that introduce new tools or final reply text; otherwise fold
 * consecutive thinking-only snapshots to the latest one.
 */
export function pickTimelineSourceMessages(messages: RawMessage[]): RawMessage[] {
  if (messages.length <= 1) return messages;

  const picked: RawMessage[] = [];
  const seenToolRoundKeys = new Set<string>();

  for (const message of messages) {
    const toolIds = messageToolIds(message);
    const toolNames = messageToolNames(message);
    const toolRoundKeys = toolIds.map((id, index) =>
      toolRoundDedupKey(id, toolNames[index] ?? id),
    );
    const hasNewTool = toolRoundKeys.some((key) => !seenToolRoundKeys.has(key));
    for (const key of toolRoundKeys) seenToolRoundKeys.add(key);

    const hasReplyText = extractText(message).trim().length > 0;
    const last = picked[picked.length - 1];

    // Claude 流式：同一 tool 轮次只保留最新快照（中间夹 text-only 也不堆叠 thinking）
    if (!hasNewTool && toolIds.length > 0) {
      const replaceIdx = findLastSameToolRoundIndex(picked, toolIds, toolNames);
      if (replaceIdx >= 0) {
        picked[replaceIdx] = message;
        continue;
      }
    }

    if (last && !hasNewTool) {
      const lastToolIds = messageToolIds(last);
      const lastToolNames = messageToolNames(last);
      const sameTools =
        toolIds.length > 0
        && lastToolIds.length > 0
        && sameToolRound(lastToolIds, lastToolNames, toolIds, toolNames);
      if (sameTools) {
        picked[picked.length - 1] = message;
        continue;
      }

      const lastText = extractText(last).trim();
      const nextText = extractText(message).trim();
      const textCompatible =
        lastText.length === 0
        || nextText.length === 0
        || nextText.startsWith(lastText)
        || lastText.startsWith(nextText);
      // 仅折叠「双 text-only」增量快照；勿用 thinking-only 覆盖已提交的旁白 text
      if (
        textCompatible
        && toolIds.length === 0
        && lastToolIds.length === 0
        && lastText.length > 0
        && nextText.length > 0
      ) {
        picked[picked.length - 1] = message;
        continue;
      }
    }

    if (picked.length === 0 || hasNewTool) {
      picked.push(message);
      continue;
    }

    if (hasReplyText) {
      if (toolIds.length === 0 && last) {
        const lastToolIds = messageToolIds(last);
        const lastText = extractText(last).trim();
        const nextText = extractText(message).trim();
        if (
          lastToolIds.length === 0
          && lastText.length > 0
          && nextText.length > 0
          && (nextText.startsWith(lastText) || lastText.startsWith(nextText))
        ) {
          picked[picked.length - 1] = message;
          continue;
        }
      }
      picked.push(message);
      continue;
    }

    if (isThinkingOnlyAssistantMessage(message)) {
      if (last && isThinkingOnlyAssistantMessage(last)) {
        picked[picked.length - 1] = message;
      } else {
        picked.push(message);
      }
      continue;
    }

    // thinking + 已知 tool、无正文
    if (toolIds.length > 0 && !hasNewTool) {
      if (last && sameToolIdSet(messageToolIds(last), toolIds)) {
        picked[picked.length - 1] = message;
        continue;
      }
    }

    picked.push(message);
  }

  return picked;
}

/** Merge timelines from multiple assistant snapshots; renumber tools sequentially. */
export function mergeThinkingTimelines(messages: RawMessage[]): ThinkingTimelineItem[] {
  const merged: ThinkingTimelineItem[] = [];
  let toolIndex = 0;

  for (const message of pickTimelineSourceMessages(messages)) {
    for (const item of extractThinkingTimeline(message)) {
      if (item.type === 'tool') {
        toolIndex += 1;
        merged.push({
          ...item,
          index: toolIndex,
          id: item.id || `tool-${toolIndex}`,
        });
      } else {
        const prev = merged[merged.length - 1];
        if (prev?.type === 'thinking' && isRedundantThinking(prev.content, item.content)) {
          merged[merged.length - 1] = {
            type: 'thinking',
            content: preferThinkingContent(prev.content, item.content),
          };
          continue;
        }
        merged.push(item);
      }
    }
  }

  return merged;
}

export type TurnTimelineEntry =
  | { kind: 'assistant'; message: RawMessage }
  | { kind: 'tool-result'; message: RawMessage };

function findTurnStartIndex(
  sessionMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
): number {
  const anchorUser = precedingUserMessage ?? findLastUserMessage(sessionMessages);
  if (!anchorUser) return 0;
  const byId = anchorUser.id
    ? sessionMessages.findIndex((message) => message.id === anchorUser.id)
    : -1;
  return byId >= 0 ? byId + 1 : sessionMessages.indexOf(anchorUser) + 1;
}

/**
 * 按 session 原始顺序遍历本轮 assistant + tool_result（含被 pick 折叠的中间 snapshot 之后的 tool_result）。
 * 完成态解析用：tool_use 未写入 assistant snapshot 时，仍可从 tool_result 恢复工具 chronology。
 */
export function walkTurnChronologicalEntries(
  sessionMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
): TurnTimelineEntry[] {
  const startIndex = findTurnStartIndex(sessionMessages, precedingUserMessage);
  const entries: TurnTimelineEntry[] = [];

  for (let i = startIndex; i < sessionMessages.length; i += 1) {
    const message = sessionMessages[i]!;
    const role = normalizeRole(message.role);
    if (role === 'user') break;
    if (role === 'toolresult' || role === 'tool_result') {
      entries.push({ kind: 'tool-result', message });
      continue;
    }
    if (!isAssistantRole(message.role)) continue;
    if (isHiddenDuplicateWorkflowPreambleAssistantMessage(message, sessionMessages, i)) {
      continue;
    }
    entries.push({ kind: 'assistant', message });
  }

  return entries;
}

/**
 * 从 session 锚点收集本轮 assistant 快照（跳过 tool_result 行）。
 * live / done 共用：比 turnMessages 更完整，避免 promoted snapshot 滞后。
 */
export function collectTurnAssistantSources(
  sessionMessages: RawMessage[],
  turnMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
  streamMessage: RawMessage | null = null,
): RawMessage[] {
  const startIndex = findTurnStartIndex(sessionMessages, precedingUserMessage);
  const sources: RawMessage[] = [];

  if (startIndex > 0) {
    for (let i = startIndex; i < sessionMessages.length; i += 1) {
      const message = sessionMessages[i]!;
      if (normalizeRole(message.role) === 'user') break;
      if (normalizeRole(message.role) === 'toolresult' || normalizeRole(message.role) === 'tool_result') {
        continue;
      }
      if (!isAssistantRole(message.role)) continue;
      sources.push(message);
    }
  }

  if (sources.length === 0) {
    sources.push(...turnMessages);
  }

  if (streamMessage) {
    const last = sources[sources.length - 1];
    if (last && shouldReplaceStreamSnapshot(last, streamMessage)) {
      sources[sources.length - 1] = streamMessage;
    } else {
      sources.push(streamMessage);
    }
  }

  return sources;
}

/**
 * 与 buildChatDisplayItems assistant-turn key 对齐。
 * 用 preceding user id，避免最终回复写入后 `turn-${start}-${lastId}` 漂移。
 */
export function buildTurnStableKey(
  precedingUserMessage: RawMessage | null | undefined,
  startIndex: number,
  fallbackTail?: string | number,
): string {
  if (precedingUserMessage?.id) {
    return `turn-user-${precedingUserMessage.id}`;
  }
  return `turn-${startIndex}-${fallbackTail ?? startIndex}`;
}

/**
 * 当前活跃轮次 key：优先最后一组 assistant-turn，否则用最近 user 消息。
 * runtime 写工具缓存与 UI remount 读缓存必须共用此函数。
 */
export function resolveActiveTurnStableKey(messages: RawMessage[]): string | null {
  if (messages.length === 0) return null;

  const items = buildChatDisplayItems(messages);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type === 'assistant-turn') {
      return item.key;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (normalizeRole(msg?.role) === 'user' && msg?.id) {
      return buildTurnStableKey(msg, i);
    }
  }

  return null;
}

/** @deprecated 使用 resolveActiveTurnStableKey */
export function computeLatestTurnStableKey(messages: RawMessage[]): string | null {
  return resolveActiveTurnStableKey(messages);
}

/**
 * session 中 tool_result 已被 loadHistory 滤掉时的 fallback：
 * 按「一轮 tool → 一条 assistant snapshot」交错 tool_result。
 */
export function buildChronologicalFallbackEntries(
  turnMessages: RawMessage[],
  cachedToolResults: RawMessage[],
): TurnTimelineEntry[] {
  if (turnMessages.length === 0 && cachedToolResults.length === 0) return [];

  const entries: TurnTimelineEntry[] = [];
  let toolIndex = 0;

  for (let messageIndex = 0; messageIndex < turnMessages.length; messageIndex += 1) {
    entries.push({ kind: 'assistant', message: turnMessages[messageIndex]! });
    const isLastAssistant = messageIndex === turnMessages.length - 1;
    if (!isLastAssistant && toolIndex < cachedToolResults.length) {
      entries.push({ kind: 'tool-result', message: cachedToolResults[toolIndex]! });
      toolIndex += 1;
    }
  }

  while (toolIndex < cachedToolResults.length) {
    entries.push({ kind: 'tool-result', message: cachedToolResults[toolIndex]! });
    toolIndex += 1;
  }

  return entries;
}

/**
 * 优先 session 时间线；无 tool_result 行时用 turnMessages + 缓存 tool_result 交错。
 */
export function resolveTurnChronologicalEntries(
  sessionMessages: RawMessage[],
  precedingUserMessage: RawMessage | null,
  turnMessages: RawMessage[],
  cachedToolResults: RawMessage[],
): TurnTimelineEntry[] {
  const fromSession = walkTurnChronologicalEntries(sessionMessages, precedingUserMessage);
  if (fromSession.some((entry) => entry.kind === 'tool-result')) {
    return fromSession;
  }
  if (cachedToolResults.length > 0) {
    return buildChronologicalFallbackEntries(turnMessages, cachedToolResults);
  }
  return fromSession;
}

export function findLastUserMessage(messages: RawMessage[]): RawMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (normalizeRole(messages[i].role) === 'user') return messages[i];
  }
  return null;
}

export function buildChatDisplayItems(messages: RawMessage[]): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = [];
  let lastUserMessage: RawMessage | null = null;
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    const role = normalizeRole(msg.role);

    if (role === 'toolresult' || role === 'tool_result') {
      i += 1;
      continue;
    }

    if (role === 'user') {
      if (isHiddenWorkflowCompleteUserMessage(msg)) {
        i += 1;
        continue;
      }
      if (isHiddenWorkflowParamsUserMessage(msg, messages, i)) {
        i += 1;
        continue;
      }
      lastUserMessage = msg;
      items.push({ type: 'single', message: msg, key: msg.id || `user-${i}` });
      i += 1;
      continue;
    }

    if (isAssistantRole(msg.role)) {
      if (isHiddenDuplicateWorkflowPreambleAssistantMessage(msg, messages, i)) {
        i += 1;
        continue;
      }

      const start = i;
      const turnMessages: RawMessage[] = [];
      const turnToolResults: RawMessage[] = [];
      while (i < messages.length) {
        const current = messages[i];
        const currentRole = normalizeRole(current.role);
        if (currentRole === 'user') break;
        if (currentRole === 'toolresult' || currentRole === 'tool_result') {
          turnToolResults.push(current);
          i += 1;
          continue;
        }
        if (!isAssistantRole(current.role)) break;
        if (isHiddenDuplicateWorkflowPreambleAssistantMessage(current, messages, i)) {
          i += 1;
          continue;
        }
        // 方案 A：分组参数 intro 与 workflow_card 执行卡不能合并成同一 assistant-turn
        if (
          turnMessages.length > 0
          && messageHasWorkflowCard(current)
          && turnMessages.some(isWorkflowPreambleAssistantMessage)
        ) {
          break;
        }
        turnMessages.push(current);
        i += 1;
      }

      if (turnMessages.length === 0) continue;

      const hasMultiple = turnMessages.length > 1;
      const onlyThinkingSnapshots = turnMessages.every(isThinkingOnlyAssistantMessage);

      if (hasMultiple || onlyThinkingSnapshots) {
        items.push({
          type: 'assistant-turn',
          messages: turnMessages,
          toolResults: turnToolResults,
          precedingUserMessage: lastUserMessage ?? undefined,
          key: buildTurnStableKey(lastUserMessage, start, turnMessages[0]?.id ?? i),
        });
      } else {
        items.push({
          type: 'single',
          message: turnMessages[0],
          key: turnMessages[0].id || `assistant-${start}`,
        });
      }
      continue;
    }

    items.push({ type: 'single', message: msg, key: msg.id || `msg-${i}` });
    i += 1;
  }

  return items;
}

/** Pick the message that carries the user-visible assistant reply (last with text). */
export function pickAssistantReplyMessage(messages: RawMessage[]): RawMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (extractText(messages[i]).trim().length > 0) return messages[i];
  }
  return messages[messages.length - 1] ?? null;
}
