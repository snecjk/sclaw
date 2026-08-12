import { stripCronLabelPrefix } from '@/lib/cron-session-display';
import {
  collapseWhitespaceForPairing,
  normalizeUserMessageForDisplay,
} from '@/lib/user-message-display';
import { parseSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import { resolveStoredSessionLabel } from '@/lib/session-label';
import { isWorkflowSessionTitle } from '@/lib/workflow-session';
import {
  isCorruptedSessionLabel,
  isPlaceholderSessionLabel,
  truncateSessionLabel,
} from '@/lib/workflow-session-hint';
import {
  formatChatSessionTraceLine,
  traceChatSession,
  truncateChatSessionText,
} from '../../../shared/chat-session-trace';
import { getMessageText, toMs } from './helpers';
import type { AttachedFileMeta, RawMessage } from './types';
import { logUserQuestion, logUserQuestionServerEcho } from './chat-flow-log';

const OPTIMISTIC_SEND_WINDOW_MS = 5_000;
/** Broad window for matching a late Gateway user echo to the current send. */
const SERVER_ECHO_WINDOW_MS = 120_000;

export function normalizeUserMessageText(content: unknown): string {
  return getMessageText(content)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 若存在 skill-marker 的 userText 则优先使用——gateway 正文仍可能带 prompt/标题前缀。 */
function normalizeUserMessageForPairing(content: unknown): string {
  const raw = getMessageText(content);
  const markerMatch = /<!--\s*SClaw-Skill\s+(\{[\s\S]*?\})\s*-->/.exec(raw);
  if (markerMatch) {
    try {
      const parsed = JSON.parse(markerMatch[1]) as { userText?: string };
      const userText = parsed.userText?.trim();
      if (userText) return collapseWhitespaceForPairing(userText);
    } catch {
      // 解析失败则继续走下方归一化逻辑
    }
  }
  // 当 marker 中的标题与首行技能标题相同时，去掉该标题行。
  const meta = parseSkillTranscriptMarker(raw);
  const normalized = collapseWhitespaceForPairing(normalizeUserMessageForDisplay(raw));
  if (meta?.title) {
    const title = meta.title.trim();
    if (normalized === title) return '';
    if (normalized.startsWith(`${title} `)) {
      return normalized.slice(title.length).trim();
    }
  }
  return normalized;
}

function getAttachmentKeys(message: RawMessage): string[] {
  return (message._attachedFiles ?? [])
    .map((file) => file.filePath || file.fileName)
    .filter(Boolean)
    .sort();
}

function hasAttachmentEvidence(message: RawMessage): boolean {
  if ((message._attachedFiles ?? []).length > 0) return true;
  const text = getMessageText(message.content);
  if (/\[media attached:/i.test(text)) return true;
  if (/\[文件:\s*[^\]]*\]/.test(text)) return true;
  if (!Array.isArray(message.content)) return false;
  return message.content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const type = (block as { type?: unknown }).type;
    return type === 'image'
      || type === 'image_url'
      || type === 'input_image'
      || type === 'file';
  });
}

function attachmentsMatch(a: RawMessage, b: RawMessage): boolean {
  const aKeys = getAttachmentKeys(a);
  const bKeys = getAttachmentKeys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index]);
}

function displayTextEquals(a: RawMessage, b: RawMessage): boolean {
  const aText = normalizeUserMessageForPairing(a.content);
  const bText = normalizeUserMessageForPairing(b.content);
  return aText.length > 0 && aText === bText;
}

function displayTextMatches(a: RawMessage, b: RawMessage): boolean {
  return displayTextEquals(a, b) && attachmentsMatch(a, b);
}

function mediaEchoTextMatches(a: RawMessage, b: RawMessage): boolean {
  return displayTextEquals(a, b)
    && !attachmentsMatch(a, b)
    && (hasAttachmentEvidence(a) || hasAttachmentEvidence(b));
}

/**
 * 技能首轮回显的软证据：gateway 常在 userText 前加 defaultPrompt。
 * 乐观展示文案须是候选配对文本的非空后缀/子串——不同编辑文案不会匹配上一轮。
 */
function skillGatewayPromptEchoMatches(candidate: RawMessage, optimistic: RawMessage): boolean {
  const optimisticText = normalizeUserMessageForPairing(optimistic.content);
  if (!optimisticText) return false;
  const candidateText = normalizeUserMessageForPairing(candidate.content);
  if (!candidateText) return false;
  if (candidateText === optimisticText) return true;
  return candidateText.endsWith(optimisticText) || candidateText.includes(optimisticText);
}

function hasSkillUserMeta(message: RawMessage): boolean {
  return message.role === 'user' && Boolean(message._skillMeta || message._skillMetas?.length);
}

function hasWorkflowBakeEvidence(message: RawMessage): boolean {
  if (message._composerSegments?.some((seg) => seg.type === 'workflow')) return true;
  return /帮我执行\s*id\s*为/.test(getMessageText(message.content));
}

/** 乐观消息（或回显）带有值得用于配对的文件/技能/工作流结构。 */
function hasComposerPairingEvidence(message: RawMessage): boolean {
  if (hasSkillUserMeta(message)) return true;
  if ((message._attachedFiles ?? []).length > 0) return true;
  if (message._composerSegments?.some((seg) => (
    seg.type === 'file' || seg.type === 'skill' || seg.type === 'workflow' || seg.type === 'mention'
  ))) {
    return true;
  }
  return false;
}

function emptyDisplayBoth(a: RawMessage, b: RawMessage): boolean {
  return !normalizeUserMessageForPairing(a.content) && !normalizeUserMessageForPairing(b.content);
}

function composerStructureEchoMatches(candidate: RawMessage, optimistic: RawMessage): boolean {
  if (!hasComposerPairingEvidence(optimistic)) return false;

  // 两轮已完成且显式附件不同，视为不同轮次。
  const optimisticKeys = getAttachmentKeys(optimistic);
  const candidateKeys = getAttachmentKeys(candidate);
  if (
    optimisticKeys.length > 0
    && candidateKeys.length > 0
    && !attachmentsMatch(optimistic, candidate)
  ) {
    return false;
  }

  if (displayTextEquals(candidate, optimistic) || mediaEchoTextMatches(candidate, optimistic)) {
    return true;
  }

  // 仅 chip、无 displayText 的发送：当回显有匹配的 bake 证据时再配对。
  if (emptyDisplayBoth(candidate, optimistic)) {
    if (hasAttachmentEvidence(optimistic) && hasAttachmentEvidence(candidate)) return true;
    if (
      optimistic._composerSegments?.some((seg) => seg.type === 'workflow')
      && hasWorkflowBakeEvidence(candidate)
    ) {
      return true;
    }
    if (hasSkillUserMeta(optimistic) && (hasSkillUserMeta(candidate) || /\[技能:/.test(getMessageText(candidate.content)))) {
      return true;
    }
  }

  return false;
}

/** User bubble is visible when there is display text and/or a skill tag. */
export function hasVisibleUserMessageContent(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  if (hasSkillUserMeta(message)) return true;
  if (message._composerSegments?.length) return true;
  if ((message._attachedFiles ?? []).length > 0) return true;
  if (hasWorkflowBakeEvidence(message)) return true;
  if (/\[文件:\s*[^\]]*\]|\[技能:\s*[^\]]*\]/.test(getMessageText(message.content))) return true;
  return normalizeUserMessageForDisplay(getMessageText(message.content)).length > 0;
}

function mergeAttachedFiles(
  preferred?: AttachedFileMeta[],
  fallback?: AttachedFileMeta[],
): AttachedFileMeta[] | undefined {
  if (!preferred?.length && !fallback?.length) return preferred ?? fallback;
  const merged: AttachedFileMeta[] = [];
  const seen = new Set<string>();
  for (const file of [...(preferred ?? []), ...(fallback ?? [])]) {
    const key = `${file.filePath || ''}|${file.fileName}|${file.mimeType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged.length ? merged : undefined;
}

/**
 * 乐观↔history 配对成功后，把 Composer UI 字段写回服务端回显。
 * `content` 必须保持为 displayText（不含 stage-6 占位符 / 工作流执行 bake）。
 */
export function patchComposerUserMessageFromOptimistic(
  serverMessage: RawMessage,
  optimistic: RawMessage,
): RawMessage {
  const displayContent = typeof optimistic.content === 'string'
    ? optimistic.content
    : normalizeUserMessageForDisplay(getMessageText(serverMessage.content));

  return {
    ...serverMessage,
    content: displayContent,
    _skillMeta: optimistic._skillMeta ?? serverMessage._skillMeta,
    _skillMetas: optimistic._skillMetas
      ?? (optimistic._skillMeta ? [optimistic._skillMeta] : undefined)
      ?? serverMessage._skillMetas,
    _composerSegments: optimistic._composerSegments ?? serverMessage._composerSegments,
    _attachedFiles: mergeAttachedFiles(optimistic._attachedFiles, serverMessage._attachedFiles)
      ?? serverMessage._attachedFiles,
  };
}

function applyOptimisticComposerDisplay(
  enrichedMessages: RawMessage[],
  optimistic: RawMessage | undefined,
  historyEcho: RawMessage,
  _refAt: number,
): RawMessage[] {
  if (!optimistic) return enrichedMessages;
  // 只 patch 已配对的那条回显。禁止用宽松 isSameUserMessage 广播——
  // 否则编辑重发时会把上一轮技能写到最新一轮。
  const echoIndex = enrichedMessages.indexOf(historyEcho);
  return enrichedMessages.map((message, index) => {
    if (echoIndex >= 0) {
      return index === echoIndex
        ? patchComposerUserMessageFromOptimistic(message, optimistic)
        : message;
    }
    if (message.id && historyEcho.id && message.id === historyEcho.id) {
      return patchComposerUserMessageFromOptimistic(message, optimistic);
    }
    return message;
  });
}

function isNearUserSend(message: RawMessage, userMessageAt: number): boolean {
  if (message.role !== 'user' || !userMessageAt) return false;
  const ts = typeof message.timestamp === 'number' ? toMs(message.timestamp) : NaN;
  return Number.isFinite(ts) && Math.abs(ts - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS;
}

function isLikelyOptimisticEcho(message: RawMessage, userMessageAt: number): boolean {
  return isNearUserSend(message, userMessageAt);
}

export function isSameUserMessage(
  candidate: RawMessage,
  optimistic: RawMessage,
  userMessageAt: number,
): boolean {
  if (candidate.role !== 'user') return false;
  if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;

  const displayMatches = displayTextMatches(candidate, optimistic);
  const mediaTextMatches = mediaEchoTextMatches(candidate, optimistic);
  const structureMatches = composerStructureEchoMatches(candidate, optimistic);
  const textsEqual = displayTextEquals(candidate, optimistic);
  const candidateText = normalizeUserMessageText(candidate.content);
  const optimisticText = normalizeUserMessageText(optimistic.content);
  const rawTextMatches = candidateText.length > 0
    && candidateText === optimisticText
    && attachmentsMatch(candidate, optimistic);

  const candidateMs = typeof candidate.timestamp === 'number' ? toMs(candidate.timestamp) : NaN;
  const optimisticMs = typeof optimistic.timestamp === 'number' ? toMs(optimistic.timestamp) : userMessageAt;
  const hasCandidateTime = Number.isFinite(candidateMs);
  const referenceMs = Number.isFinite(optimisticMs) ? optimisticMs : userMessageAt;
  const evidence = textsEqual || structureMatches || mediaTextMatches || rawTextMatches || displayMatches;

  if (optimistic._skillMeta || optimistic._skillMetas?.length) {
    if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;
    // 与文件/工作流一致：禁止仅靠时间配对。紧窗口内也可用
    // 软后缀证据应对 gateway 首轮回显的 defaultPrompt 前缀。
    const skillEvidence = evidence || skillGatewayPromptEchoMatches(candidate, optimistic);
    if (hasCandidateTime && Number.isFinite(referenceMs)) {
      if (
        Math.abs(candidateMs - referenceMs) < OPTIMISTIC_SEND_WINDOW_MS
        && skillEvidence
      ) {
        return true;
      }
    }
    if (
      evidence
      && userMessageAt > 0
      && hasCandidateTime
      && Math.abs(candidateMs - userMessageAt) < SERVER_ECHO_WINDOW_MS
    ) {
      return true;
    }
  }

  // 文件/工作流/多 segment：时间窗 + 剥离后的展示文案（或 bake 证据）。
  if (hasComposerPairingEvidence(optimistic) && !optimistic._skillMeta && !(optimistic._skillMetas?.length)) {
    if (hasCandidateTime && Number.isFinite(referenceMs)) {
      if (Math.abs(candidateMs - referenceMs) < OPTIMISTIC_SEND_WINDOW_MS) {
        if (structureMatches || displayMatches || mediaTextMatches || rawTextMatches) return true;
      }
      if (
        structureMatches
        && userMessageAt > 0
        && Math.abs(candidateMs - referenceMs) <= SERVER_ECHO_WINDOW_MS
      ) {
        return true;
      }
    }
    if (
      structureMatches
      && userMessageAt > 0
      && hasCandidateTime
      && Math.abs(candidateMs - userMessageAt) <= SERVER_ECHO_WINDOW_MS
    ) {
      return true;
    }
  }

  if (hasCandidateTime && Number.isFinite(referenceMs)) {
    if (Math.abs(candidateMs - referenceMs) < OPTIMISTIC_SEND_WINDOW_MS) {
      return displayMatches || rawTextMatches || mediaTextMatches || structureMatches;
    }
    // During an active send, identical display text is the optimistic/server pair even when
    // Gateway timestamps are missing or skewed.
    if (displayMatches && userMessageAt > 0) return true;
    if (rawTextMatches && userMessageAt > 0) return true;
    if (structureMatches && userMessageAt > 0) return true;
    if (
      mediaTextMatches
      && userMessageAt > 0
      && Math.abs(candidateMs - referenceMs) <= SERVER_ECHO_WINDOW_MS
    ) {
      return true;
    }
    if (Math.abs(candidateMs - referenceMs) > 60_000) return false;
  }

  return displayMatches || rawTextMatches || structureMatches;
}

/** 在 Gateway history 中查找与乐观发送副本配对的用户轮次。 */
export function findHistoryUserEcho(
  enrichedMessages: RawMessage[],
  optimistic: RawMessage,
  userMessageAt: number,
): RawMessage | undefined {
  return enrichedMessages.find((message) => {
    if (message.role !== 'user') return false;
    if (isSameUserMessage(message, optimistic, userMessageAt)) return true;
    if (!displayTextMatches(message, optimistic) && !composerStructureEchoMatches(message, optimistic)) {
      return false;
    }
    const ts = typeof message.timestamp === 'number' ? toMs(message.timestamp) : NaN;
    if (!Number.isFinite(ts)) return userMessageAt > 0;
    return Math.abs(ts - userMessageAt) <= SERVER_ECHO_WINDOW_MS;
  });
}

export function insertOptimisticUserMessage(messages: RawMessage[], optimistic: RawMessage): RawMessage[] {
  const optimisticMs = typeof optimistic.timestamp === 'number' ? toMs(optimistic.timestamp) : NaN;
  if (!Number.isFinite(optimisticMs)) return [...messages, optimistic];

  const insertAt = messages.findIndex((message) => {
    if (typeof message.timestamp !== 'number') return false;
    return toMs(message.timestamp) > optimisticMs;
  });

  if (insertAt === -1) return [...messages, optimistic];
  return [
    ...messages.slice(0, insertAt),
    optimistic,
    ...messages.slice(insertAt),
  ];
}

function summarizeUserMessage(message: RawMessage): Record<string, unknown> {
  return {
    id: message.id,
    ts: message.timestamp,
    rawLen: normalizeUserMessageText(message.content).length,
    display: truncateChatSessionText(normalizeUserMessageForPairing(message.content)),
  };
}

function isRedundantSkillUserDuplicate(first: RawMessage, second: RawMessage): boolean {
  if (first.role !== 'user' || second.role !== 'user') return false;
  if (first.id?.startsWith('session-label-user-') || second.id?.startsWith('session-label-user-')) {
    return false;
  }

  if (!first._skillMeta || !second._skillMeta) return false;
  if (first._skillMeta.slug !== second._skillMeta.slug) return false;

  const firstDisplay = normalizeUserMessageForPairing(first.content);
  const secondDisplay = normalizeUserMessageForPairing(second.content);
  if (firstDisplay && firstDisplay === secondDisplay) return true;

  const title = first._skillMeta.title.trim();
  if (!firstDisplay && secondDisplay === title) return true;
  if (!secondDisplay && firstDisplay === title) return true;
  return false;
}

/** Drop later copies of the same user turn (optimistic + server, or double insert). */
export function dedupeRedundantUserMessages(
  messages: RawMessage[],
  userMessageAt: number | null,
  traceContext?: { sessionKey?: string },
): RawMessage[] {
  if (messages.length < 2) return messages;

  const refAt = userMessageAt ?? 0;
  const drop = new Set<number>();
  const droppedIds: string[] = [];
  const patches = new Map<number, RawMessage>();

  const patchKeptUser = (keptIndex: number, droppedMessage: RawMessage) => {
    const kept = patches.get(keptIndex) ?? messages[keptIndex];
    if (!kept || kept.role !== 'user') return;
    // 合并重复项时，优先保留仍带 Composer UI 结构的一侧。
    const preferred = droppedMessage._composerSegments?.length
      || droppedMessage._skillMeta
      || droppedMessage._attachedFiles?.length
      ? droppedMessage
      : (kept._composerSegments?.length || kept._skillMeta || kept._attachedFiles?.length
        ? kept
        : droppedMessage);
    const base = preferred === droppedMessage ? kept : droppedMessage;
    const donor = preferred === droppedMessage ? droppedMessage : kept;
    patches.set(keptIndex, patchComposerUserMessageFromOptimistic(base, donor));
  };

  for (let i = 0; i < messages.length; i += 1) {
    if (drop.has(i)) continue;
    const first = messages[i];
    if (first.role !== 'user') continue;

    for (let j = i + 1; j < messages.length; j += 1) {
      if (drop.has(j)) continue;
      const second = messages[j];
      if (second.role !== 'user') continue;

      // True duplicate (same id) — drop regardless of position.
      if (first.id && second.id && first.id === second.id) {
        drop.add(j);
        if (second.id) droppedIds.push(second.id);
        continue;
      }

      const sameTurnByDisplay = displayTextMatches(first, second)
        || composerStructureEchoMatches(first, second)
        || composerStructureEchoMatches(second, first);

      // Synthetic opener from session label vs real history user (may be non-adjacent).
      const firstSynthetic = typeof first.id === 'string' && first.id.startsWith('session-label-user-');
      const secondSynthetic = typeof second.id === 'string' && second.id.startsWith('session-label-user-');
      if (sameTurnByDisplay && (firstSynthetic || secondSynthetic)) {
        if (firstSynthetic && !secondSynthetic) {
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
        if (secondSynthetic) {
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
      }

      // Only ADJACENT user messages can be the same turn (an optimistic user
      // message and its server echo, or a double insert). Two user messages separated by
      // an assistant reply (or anything else) are distinct turns and must be kept
      // — even when their text is identical. Collapsing them by text alone was
      // the "identical input overwrites the previous output" bug: the second
      // user message was dropped, the two assistant replies merged into one turn,
      // and only the latest reply rendered.
      if (j === i + 1) {
        if (first.id?.startsWith('session-label-user-') && second._skillMeta) {
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
        if (second.id?.startsWith('session-label-user-') && first._skillMeta) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        if (isSameUserMessage(second, first, refAt) || isSameUserMessage(first, second, refAt)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        if (isRedundantSkillUserDuplicate(first, second)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
          continue;
        }
        const firstText = normalizeUserMessageText(first.content);
        const secondText = normalizeUserMessageText(second.content);
        if (firstText && firstText === secondText && attachmentsMatch(first, second)) {
          patchKeptUser(i, second);
          drop.add(j);
          if (second.id) droppedIds.push(second.id);
        }
        continue;
      }

      // During an active send, drop a non-adjacent optimistic echo when Gateway
      // history already contains the same visible user turn (often separated by
      // assistant/tool messages that arrived via streaming before loadHistory).
      if (refAt > 0 && sameTurnByDisplay) {
        const firstOptimistic = isLikelyOptimisticEcho(first, refAt);
        const secondOptimistic = isLikelyOptimisticEcho(second, refAt);
        // Only drop the in-flight optimistic copy; never drop a later real user
        // turn that happens to reuse the same visible text.
        if (firstOptimistic && !secondOptimistic) {
          patchKeptUser(j, first);
          drop.add(i);
          if (first.id) droppedIds.push(first.id);
          break;
        }
      }
    }
  }

  if (drop.size === 0) return messages;

  traceChatSession({
    phase: 'dedupe-user',
    action: 'drop-duplicate-user',
    sessionKey: traceContext?.sessionKey,
    userMessageAt,
    messageCountBefore: messages.length,
    messageCountAfter: messages.length - drop.size,
    droppedMessageIds: droppedIds,
    reason: refAt > 0 ? 'active-send-echo' : 'same-id-or-adjacent',
    detail: {
      droppedIndexes: [...drop],
      keptUsers: messages
        .filter((_, index) => !drop.has(index) && messages[index]?.role === 'user')
        .map(summarizeUserMessage),
    },
  });

  return messages
    .map((message, index) => patches.get(index) ?? message)
    .filter((_, index) => !drop.has(index));
}

function historyHasVisibleUserMessage(messages: RawMessage[]): boolean {
  return messages.some((message) => hasVisibleUserMessageContent(message));
}

function findRecoverableUserMessage(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  userMessageAt: number | null,
  cachedOptimistic?: RawMessage | null,
): RawMessage | undefined {
  if (userMessageAt) {
    const fromCurrent = [...currentMessages].reverse().find(
      (message) => message.role === 'user'
        && message.timestamp
        && Math.abs(toMs(message.timestamp) - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS,
    );
    if (fromCurrent) return fromCurrent;
    if (
      cachedOptimistic
      && cachedOptimistic.role === 'user'
      && cachedOptimistic.timestamp
      && Math.abs(toMs(cachedOptimistic.timestamp) - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS
    ) {
      return cachedOptimistic;
    }
  }

  const candidates = [
    ...(cachedOptimistic?.role === 'user' ? [cachedOptimistic] : []),
    ...currentMessages.filter((message) => message.role === 'user'),
  ];
  for (const candidate of candidates) {
    const display = normalizeUserMessageForDisplay(getMessageText(candidate.content));
    if (!display && !candidate._skillMeta && !candidate._composerSegments?.length && !candidate._attachedFiles?.length) {
      continue;
    }
    const refAt = userMessageAt ?? (candidate.timestamp ? toMs(candidate.timestamp) : 0);
    if (findHistoryUserEcho(enrichedMessages, candidate, refAt)) continue;
    if (enrichedMessages.some((message) => message.role === 'user' && displayTextMatches(message, candidate))) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

function earliestMessageTimestampMs(messages: RawMessage[]): number | undefined {
  let min: number | undefined;
  for (const message of messages) {
    if (typeof message.timestamp !== 'number') continue;
    const ms = toMs(message.timestamp);
    if (ms <= 0) continue;
    min = min === undefined ? ms : Math.min(min, ms);
  }
  return min;
}

function openingUserTimestampSeconds(messages: RawMessage[]): number {
  const earliestMs = earliestMessageTimestampMs(messages);
  return earliestMs !== undefined ? (earliestMs - 1) / 1000 : Date.now() / 1000;
}

function resolveOpeningSessionLabel(
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
): string | undefined {
  const stored = resolveStoredSessionLabel(sessionKey, sessionLabels)?.trim();
  if (
    stored
    && !isWorkflowSessionTitle(stored)
    && !isCorruptedSessionLabel(stored)
    && !isPlaceholderSessionLabel(stored)
  ) {
    return stripCronLabelPrefix(stored) || stored;
  }
  const label = gatewayLabel?.trim();
  if (
    label
    && !isWorkflowSessionTitle(label)
    && !isCorruptedSessionLabel(label)
    && !isPlaceholderSessionLabel(label)
  ) {
    return stripCronLabelPrefix(label) || label;
  }
  return undefined;
}

function historyHasOpeningUserTurn(messages: RawMessage[], openingLabel: string | undefined): boolean {
  if (!openingLabel) return false;
  const normalizedLabel = normalizeUserMessageForDisplay(openingLabel);
  return messages.some((message) => {
    if (message.role !== 'user') return false;
    const raw = getMessageText(message.content);
    const display = normalizeUserMessageForDisplay(raw);
    if (message._skillMeta) {
      if (!display) return message._skillMeta.title === openingLabel;
      return display === openingLabel || message._skillMeta.title === openingLabel;
    }
    // 会话标题最长 50 字符，且可能仍含 gateway bake
    // （工作流执行句 / 占位符）。需同时匹配 display、raw 与截断形式。
    return display === openingLabel
      || display === normalizedLabel
      || truncateSessionLabel(display) === openingLabel
      || truncateSessionLabel(raw.replace(/\s+/g, ' ').trim()) === openingLabel
      || raw.replace(/\s+/g, ' ').trim() === openingLabel;
  });
}

function historyHasSkillUserTurn(messages: RawMessage[]): boolean {
  return messages.some((message) => message.role === 'user' && Boolean(message._skillMeta));
}

/** Drop synthetic session-label user rows when a real skill-tagged user turn already exists. */
export function dropSyntheticSkillSessionLabelUsers(messages: RawMessage[]): RawMessage[] {
  if (!historyHasSkillUserTurn(messages)) return messages;
  return messages.filter((message) => {
    if (message.role !== 'user') return true;
    return !message.id?.startsWith('session-label-user-');
  });
}

/** Reconstruct the opening user turn from a stored session title when history omits it. */
export function recoverInitialUserFromSessionLabel(
  enrichedMessages: RawMessage[],
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
  options?: { sending?: boolean },
): RawMessage[] {
  // Mid-send: optimistic user already covers the opener; label recovery doubles it.
  if (options?.sending) return enrichedMessages;
  if (historyHasSkillUserTurn(enrichedMessages)) return enrichedMessages;
  const label = resolveOpeningSessionLabel(sessionKey, sessionLabels, gatewayLabel);
  if (!label || historyHasOpeningUserTurn(enrichedMessages, label)) return enrichedMessages;
  return insertOptimisticUserMessage(enrichedMessages, {
    role: 'user',
    content: label,
    timestamp: openingUserTimestampSeconds(enrichedMessages),
    id: `session-label-user-${sessionKey}`,
  } as RawMessage);
}

/** Keep the session-opening user turn before assistant/workflow messages after history merges. */
export function ensureOpeningUserMessageFirst(
  messages: RawMessage[],
  sessionKey: string,
  sessionLabels: Record<string, string>,
  gatewayLabel?: string,
  options?: { sending?: boolean },
): RawMessage[] {
  // Mid-send: do not rewrite timestamps / inject openers while stream+history race.
  if (options?.sending) return messages;
  const label = resolveOpeningSessionLabel(sessionKey, sessionLabels, gatewayLabel);
  let working = messages;
  if (label && !historyHasOpeningUserTurn(working, label)) {
    working = recoverInitialUserFromSessionLabel(working, sessionKey, sessionLabels, gatewayLabel, options);
  }

  const visibleUsers = working.filter((message) => hasVisibleUserMessageContent(message));
  if (visibleUsers.length === 0) return working;

  let openingUser = visibleUsers.reduce((earliest, message) => (
    toMs(message.timestamp) < toMs(earliest.timestamp) ? message : earliest
  ));
  if (label) {
    const labeled = visibleUsers.find(
      (message) => normalizeUserMessageForDisplay(getMessageText(message.content)) === label,
    );
    if (labeled) openingUser = labeled;
  }

  const sorted = [...working].sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp));
  const openingIndex = sorted.findIndex((message) => (
    message.id === openingUser.id
    || (message.role === 'user' && displayTextMatches(message, openingUser))
  ));
  if (openingIndex <= 0) return sorted;

  const correctedTimestamp = openingUserTimestampSeconds(working);
  const patched = working.map((message) => {
    if (message.id !== openingUser.id && !displayTextMatches(message, openingUser)) {
      return message;
    }
    if (message.role !== 'user') return message;
    return { ...message, timestamp: correctedTimestamp };
  });
  return patched.sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp));
}

/**
 * history 回显的 UI 字段供体：overlay 乐观消息，或仍带 `_composerSegments` 的上一帧投影。
 * 首轮回显清掉 overlay 后仍关键——后续 history 重载必须能再次写回 segments。
 */
function findComposerUiDonor(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  userMessageAt: number | null,
  cachedOptimistic?: RawMessage | null,
): RawMessage | undefined {
  const candidates = [
    ...(cachedOptimistic?.role === 'user' ? [cachedOptimistic] : []),
    ...currentMessages.filter((message) => message.role === 'user' && (
      Boolean(message._composerSegments?.length)
      || Boolean(message._skillMeta)
      || Boolean(message._skillMetas?.length)
      || Boolean(message._attachedFiles?.length)
    )),
  ];

  let best: { candidate: RawMessage; score: number } | undefined;
  for (const candidate of candidates) {
    const refAt = userMessageAt
      ?? (candidate.timestamp ? toMs(candidate.timestamp) : 0);
    const echo = findHistoryUserEcho(enrichedMessages, candidate, refAt);
    if (!echo) continue;

    let score = 0;
    if (displayTextEquals(echo, candidate)) score += 100;
    else if (composerStructureEchoMatches(echo, candidate)) score += 40;
    else if (mediaEchoTextMatches(echo, candidate)) score += 30;
    else if (
      (candidate._skillMeta || candidate._skillMetas?.length)
      && skillGatewayPromptEchoMatches(echo, candidate)
      && typeof echo.timestamp === 'number'
      && typeof candidate.timestamp === 'number'
      && Math.abs(toMs(echo.timestamp) - toMs(candidate.timestamp)) < OPTIMISTIC_SEND_WINDOW_MS
    ) {
      // 紧窗口内的软 prompt 前缀回显。
      score += 35;
    } else {
      score += 1; // 弱残余分——避免跨轮次误偏好
    }

    if (
      userMessageAt
      && candidate.timestamp
      && Math.abs(toMs(candidate.timestamp) - userMessageAt) < OPTIMISTIC_SEND_WINDOW_MS
    ) {
      score += 50;
    }
    if (cachedOptimistic && candidate === cachedOptimistic) score += 20;

    if (!best || score > best.score) best = { candidate, score };
  }

  // 需要真实的展示/结构/技能窗口证据（不能只靠 120s 时间残余）。
  if (best && best.score >= 30) return best.candidate;
  return undefined;
}

/** 把上一帧投影中的 composer UI 字段重新写到新加载的 history 用户消息上。 */
export function reapplyComposerUiFromPreviousDisplay(
  messages: RawMessage[],
  previousDisplay: RawMessage[],
  userMessageAt: number | null,
): RawMessage[] {
  if (!previousDisplay.length) return messages;
  const donors = previousDisplay.filter((message) => (
    message.role === 'user'
    && Boolean(message._composerSegments?.length)
  ));
  if (!donors.length) return messages;

  return messages.map((message) => {
    if (message.role !== 'user') return message;
    if (message._composerSegments?.length) return message;
    // 仅严格匹配展示文案——宽松技能配对会在 thinking 期间
    // 把上一轮拷到编辑重发的这一轮。
    const donor = donors.find((candidate) => displayTextEquals(message, candidate));
    if (!donor) {
      const refAt = userMessageAt
        ?? (message.timestamp ? toMs(message.timestamp) : 0);
      const structured = donors.find((candidate) => (
        composerStructureEchoMatches(message, candidate)
        && (
          !userMessageAt
          || (candidate.timestamp && Math.abs(toMs(candidate.timestamp) - refAt) < SERVER_ECHO_WINDOW_MS)
        )
      ));
      if (!structured) return message;
      // 双方都有可见文案时，仍要求归一化后的展示文案相等。
      if (
        normalizeUserMessageForPairing(message.content)
        && normalizeUserMessageForPairing(structured.content)
        && !displayTextEquals(message, structured)
      ) {
        return message;
      }
      return patchComposerUserMessageFromOptimistic(message, structured);
    }
    return patchComposerUserMessageFromOptimistic(message, donor);
  });
}

export function mergeOptimisticUserIntoHistory(
  enrichedMessages: RawMessage[],
  currentMessages: RawMessage[],
  options: {
    userMessageAt: number | null;
    sending: boolean;
    sessionKey?: string;
    /** Fallback when switchSession cleared messages[] but runtime still holds the optimistic user. */
    cachedOptimistic?: RawMessage | null;
  },
): RawMessage[] {
  const { userMessageAt, sending, sessionKey, cachedOptimistic } = options;

  // 只要 history 已有匹配的用户回显，就优先使用 UI 供体
  // （乐观 overlay，或带 segments 的上一帧投影）——含 overlay 乐观
  // 已清除后的中途 history 重载。
  const uiDonor = findComposerUiDonor(
    enrichedMessages,
    currentMessages,
    userMessageAt,
    cachedOptimistic,
  );
  if (uiDonor) {
    const refAt = userMessageAt ?? (uiDonor.timestamp ? toMs(uiDonor.timestamp) : 0);
    const historyEcho = findHistoryUserEcho(enrichedMessages, uiDonor, refAt);
    if (historyEcho) {
      let merged = applyOptimisticComposerDisplay(enrichedMessages, uiDonor, historyEcho, refAt);
      // 同时恢复上一帧投影里已有 segments 的其他 history 用户消息
      // （编辑重发：保留第 N 轮，同时 patch 第 N+1 轮）。
      merged = reapplyComposerUiFromPreviousDisplay(merged, currentMessages, userMessageAt);
      traceChatSession({
        phase: 'merge-optimistic',
        action: 'use-history-user',
        sessionKey,
        userMessageAt,
        sending,
        optimisticId: uiDonor.id,
        matchedHistoryUserId: historyEcho.id,
        messageCountBefore: enrichedMessages.length,
        messageCountAfter: merged.length,
        reason: uiDonor.id && historyEcho.id && uiDonor.id === historyEcho.id
          ? 'id-match'
          : 'display-or-time-match',
        detail: {
          optimistic: summarizeUserMessage(uiDonor),
          historyUser: summarizeUserMessage(historyEcho),
          donorSource: cachedOptimistic?.id && uiDonor.id === cachedOptimistic.id
            ? 'cached-optimistic'
            : 'previous-display',
        },
      });
      logUserQuestionServerEcho({
        sessionKey: sessionKey ?? null,
        matchReason: uiDonor.id && historyEcho.id && uiDonor.id === historyEcho.id
          ? 'id-match'
          : 'display-or-time-match',
        optimisticId: uiDonor.id ?? null,
        historyUserId: historyEcho.id ?? null,
        optimisticContent: getMessageText(uiDonor.content),
        historyContent: getMessageText(historyEcho.content),
        optimisticSkillMetas: uiDonor._skillMetas
          ?? (uiDonor._skillMeta ? [uiDonor._skillMeta] : undefined),
        historySkillMetas: historyEcho._skillMetas
          ?? (historyEcho._skillMeta ? [historyEcho._skillMeta] : undefined),
        optimisticSegments: uiDonor._composerSegments,
        historySegments: historyEcho._composerSegments,
        optimisticAttachments: uiDonor._attachedFiles,
        historyAttachments: historyEcho._attachedFiles,
        mergedContent: getMessageText(
          merged.find((m) => m === historyEcho || (m.id && historyEcho.id && m.id === historyEcho.id))?.content
            ?? historyEcho.content,
        ),
      });
      return merged;
    }
  }

  if (!userMessageAt && historyHasVisibleUserMessage(enrichedMessages)) {
    return enrichedMessages;
  }

  const optimistic = findRecoverableUserMessage(
    enrichedMessages,
    currentMessages,
    userMessageAt,
    cachedOptimistic,
  );
  const shouldPreserveOptimistic = !!optimistic && (
    sending
    || optimistic.isError
    || !historyHasVisibleUserMessage(enrichedMessages)
  );

  if (!historyHasVisibleUserMessage(enrichedMessages) && shouldPreserveOptimistic && optimistic) {
    traceChatSession({
      phase: 'merge-optimistic',
      action: 'insert-optimistic',
      sessionKey,
      userMessageAt,
      sending,
      optimisticId: optimistic.id,
      messageCountBefore: enrichedMessages.length,
      messageCountAfter: enrichedMessages.length + 1,
      reason: 'history-missing-user',
      detail: {
        optimistic: summarizeUserMessage(optimistic),
        historyUserCount: enrichedMessages.filter((m) => m.role === 'user').length,
      },
    });
    logUserQuestion('preserve-optimistic', {
      sessionKey: sessionKey ?? null,
      reason: 'history-missing-user',
      optimisticId: optimistic.id ?? null,
      optimisticContent: getMessageText(optimistic.content),
      skillMetas: optimistic._skillMetas
        ?? (optimistic._skillMeta ? [optimistic._skillMeta] : undefined),
      segments: optimistic._composerSegments,
      attachments: optimistic._attachedFiles,
    });
    return insertOptimisticUserMessage(enrichedMessages, optimistic);
  }

  if (optimistic && !shouldPreserveOptimistic) {
    traceChatSession({
      phase: 'merge-optimistic',
      action: 'skip-optimistic-not-sending',
      sessionKey,
      userMessageAt,
      sending,
      optimisticId: optimistic.id,
      reason: 'send-finished',
    });
  }

  return enrichedMessages;
}

/** Log loadHistory reconciliation summary (call after merge + dedupe). */
export function traceLoadHistoryUserReconciliation(params: {
  sessionKey: string;
  userMessageAt: number | null;
  sending: boolean;
  beforeCount: number;
  afterCount: number;
  userCountBefore: number;
  userCountAfter: number;
}): void {
  if (params.userCountAfter <= params.userCountBefore && params.afterCount === params.beforeCount) {
    return;
  }
  traceChatSession({
    phase: 'load-history',
    action: 'user-reconcile',
    sessionKey: params.sessionKey,
    userMessageAt: params.userMessageAt,
    sending: params.sending,
    messageCountBefore: params.beforeCount,
    messageCountAfter: params.afterCount,
    reason: `users ${params.userCountBefore}->${params.userCountAfter}`,
  });
}

export { formatChatSessionTraceLine };
