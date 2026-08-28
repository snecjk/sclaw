import {
  createFlowCardBlock,
  type FlowCardContentBlock,
  type FlowCardPayload,
  isFlowCardContentBlock,
} from '../../shared/flow-card-protocol';
import { normalizeQuoteFlowCard } from '@/lib/flow-card-quote-actions';
import { findStreamingFlowCardInMessage } from '@/lib/flow-card-marker';
import { updateCurrentChatDisplayProjection, updateSessionDisplayProjection } from '@/stores/chat/display-selectors';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { SkillMeta } from '@/types/skill-meta';

const activeCardIdBySession = new Map<string, string>();

export function getActiveFlowCardId(sessionKey: string): string | null {
  return activeCardIdBySession.get(sessionKey) ?? null;
}

export function setActiveFlowCardId(sessionKey: string, cardId: string | null): void {
  if (!cardId) activeCardIdBySession.delete(sessionKey);
  else activeCardIdBySession.set(sessionKey, cardId);
}

/** Resolve flow_card from a native block or a ```flow_card fence (display-time, no store write). */
export function extractFlowCard(message: RawMessage): FlowCardContentBlock | null {
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (isFlowCardContentBlock(block)) return normalizeQuoteFlowCard(block);
    }
  }
  const fromFence = findStreamingFlowCardInMessage(content);
  return fromFence ? normalizeQuoteFlowCard(createFlowCardBlock(fromFence)) : null;
}

export function findMessageIndexByFlowCardId(
  messages: RawMessage[],
  cardId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = extractFlowCard(messages[i]);
    if (card?.cardId === cardId) return i;
  }
  return -1;
}

function replaceFlowCardInMessage(
  message: RawMessage,
  cardId: string,
  patch: Partial<FlowCardPayload>,
): RawMessage {
  const content = message.content;
  if (!Array.isArray(content)) return message;

  let replaced = false;
  const nextContent = (content as ContentBlock[]).map((block) => {
    if (!isFlowCardContentBlock(block) || block.cardId !== cardId) return block;
    replaced = true;
    return createFlowCardBlock({ ...block, ...patch, cardId });
  });

  if (!replaced) return message;
  return { ...message, content: nextContent };
}

export function patchFlowCardInMessages(
  messages: RawMessage[],
  cardId: string,
  patch: Partial<FlowCardPayload>,
): boolean {
  const index = findMessageIndexByFlowCardId(messages, cardId);
  if (index < 0) return false;
  messages[index] = replaceFlowCardInMessage(messages[index], cardId, patch);
  return true;
}

export function patchFlowCard(
  sessionKey: string,
  cardId: string,
  patch: Partial<FlowCardPayload>,
): boolean {
  let patched = false;
  updateSessionDisplayProjection(sessionKey, (messages) => {
    const next = [...messages];
    patched = patchFlowCardInMessages(next, cardId, patch);
    return patched ? next : messages;
  });
  return patched;
}

export function patchActiveFlowCard(
  sessionKey: string,
  patch: Partial<FlowCardPayload>,
): boolean {
  const cardId = getActiveFlowCardId(sessionKey);
  if (!cardId) return false;
  return patchFlowCard(sessionKey, cardId, patch);
}

function toAttachedFiles(attachments?: FileAttachment[]) {
  return attachments?.map((file) => ({
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    preview: file.preview ?? null,
    filePath: file.stagedPath,
  }));
}

export function appendUserTurnToProjection(input: {
  sessionKey: string;
  text: string;
  attachments?: FileAttachment[];
  skillMetas?: SkillMeta[];
}): void {
  const now = Date.now() / 1000;
  updateSessionDisplayProjection(input.sessionKey, (messages) => [
    ...messages,
    {
      role: 'user',
      content: input.text,
      timestamp: now,
      id: crypto.randomUUID(),
      _attachedFiles: toAttachedFiles(input.attachments),
      _skillMetas: input.skillMetas,
    } as RawMessage,
  ]);
}

export function appendAssistantFlowCard(input: {
  sessionKey: string;
  payload: FlowCardPayload;
  introText?: string;
}): void {
  const now = Date.now() / 1000;
  setActiveFlowCardId(input.sessionKey, input.payload.cardId);
  updateSessionDisplayProjection(input.sessionKey, (messages) => [
    ...messages,
    {
      role: 'assistant',
      content: [
        ...(input.introText ? [{ type: 'text', text: input.introText } as ContentBlock] : []),
        createFlowCardBlock(input.payload),
      ],
      timestamp: now,
      id: crypto.randomUUID(),
    } as RawMessage,
  ]);
}

export function appendAssistantTextToProjection(input: {
  sessionKey: string;
  text: string;
}): void {
  const now = Date.now() / 1000;
  updateSessionDisplayProjection(input.sessionKey, (messages) => [
    ...messages,
    {
      role: 'assistant',
      content: input.text,
      timestamp: now,
      id: crypto.randomUUID(),
    } as RawMessage,
  ]);
}

export function upsertActiveFlowCard(input: {
  sessionKey: string;
  payload: FlowCardPayload;
  introText?: string;
}): void {
  const cardId = input.payload.cardId;
  setActiveFlowCardId(input.sessionKey, cardId);
  let patched = false;
  updateSessionDisplayProjection(input.sessionKey, (messages) => {
    const next = [...messages];
    patched = patchFlowCardInMessages(next, cardId, input.payload);
    if (patched) return next;
    return [
      ...next,
      {
        role: 'assistant',
        content: [
          ...(input.introText ? [{ type: 'text', text: input.introText } as ContentBlock] : []),
          createFlowCardBlock(input.payload),
        ],
        timestamp: Date.now() / 1000,
        id: crypto.randomUUID(),
      } as RawMessage,
    ];
  });
}

export { updateCurrentChatDisplayProjection };
