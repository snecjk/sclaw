import type { RawMessage } from './types';
import { STREAMING_OVERLAY_BUFFER_LIMIT, truncateToolPayload } from '../../../shared/chat-tool-payload';

export { STREAMING_OVERLAY_BUFFER_LIMIT };

export function appendStreamingAssistantSnapshot(
  messages: RawMessage[],
  message: unknown,
): RawMessage[] {
  if (!isAssistantStreamMessage(message)) return messages;
  const next = normalizeAssistantStreamMessage(message);
  if (next.id) {
    const index = messages.findIndex((item) => item.id === next.id);
    if (index >= 0) return replaceAt(messages, index, next);
  }
  return [...messages, next].slice(-STREAMING_OVERLAY_BUFFER_LIMIT);
}

export function appendStreamingToolResultSnapshot(messages: RawMessage[], message: RawMessage): RawMessage[] {
  const bounded: RawMessage = {
    ...message,
    content: truncateToolPayload(message.content),
  };
  const key = bounded.toolCallId || bounded.id || bounded.toolName;
  if (key) {
    const index = messages.findIndex((item) => (item.toolCallId || item.id || item.toolName) === key);
    if (index >= 0) return replaceAt(messages, index, bounded);
  }
  return [...messages, bounded].slice(-STREAMING_OVERLAY_BUFFER_LIMIT);
}

function isAssistantStreamMessage(message: unknown): message is RawMessage {
  return Boolean(message && typeof message === 'object'
    && ((message as RawMessage).role === 'assistant' || (message as RawMessage).role === undefined));
}

function normalizeAssistantStreamMessage(message: RawMessage): RawMessage {
  return { ...message, role: 'assistant' };
}

function replaceAt(messages: RawMessage[], index: number, message: RawMessage): RawMessage[] {
  const updated = [...messages];
  updated[index] = message;
  return updated.slice(-STREAMING_OVERLAY_BUFFER_LIMIT);
}
