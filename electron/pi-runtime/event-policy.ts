import { createHash } from 'node:crypto';
import {
  buildPartialToolInputPreview,
  DEFAULT_PARTIAL_TOOL_INPUT_PREVIEW_CHARS,
} from '../../shared/partial-tool-input-preview';
import type { PiModelConfig } from '../../shared/pi-runtime-protocol';

export type PiAssistantSnapshot = Record<string, unknown> & {
  role: 'assistant';
  content: Array<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneAssistantSnapshot(message: unknown, streamId: string): PiAssistantSnapshot | undefined {
  if (!isRecord(message) || message.role !== 'assistant') return undefined;
  return {
    ...message,
    id: typeof message.id === 'string' && message.id ? message.id : streamId,
    role: 'assistant',
    content: Array.isArray(message.content)
      ? message.content.map((block) => isRecord(block) ? { ...block } : {})
      : [],
  };
}

export function startPiAssistantSnapshot(message: unknown, streamId: string): PiAssistantSnapshot | undefined {
  return cloneAssistantSnapshot(message, streamId);
}

/**
 * Pi SDK update events carry token deltas. The canonical SClaw stream expects
 * each message.delta payload to be the complete assistant snapshot, so prefer
 * the SDK's official `partial` snapshot and assemble it when it is unavailable
 * (for example when an event crossed a JSON/RPC-compatible boundary).
 */
export function updatePiAssistantSnapshot(
  current: PiAssistantSnapshot | undefined,
  assistantMessageEvent: unknown,
  streamId: string,
): PiAssistantSnapshot | undefined {
  if (!isRecord(assistantMessageEvent)) return current;
  const officialPartial = cloneAssistantSnapshot(assistantMessageEvent.partial, streamId);
  if (officialPartial) return officialPartial;

  const contentIndex = assistantMessageEvent.contentIndex;
  if (!Number.isInteger(contentIndex) || (contentIndex as number) < 0) return current;
  const index = contentIndex as number;
  const next: PiAssistantSnapshot = current
    ? { ...current, content: current.content.map((block) => ({ ...block })) }
    : { id: streamId, role: 'assistant', content: [] };
  const previous = next.content[index];
  const delta = typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : '';

  switch (assistantMessageEvent.type) {
    case 'text_start':
      next.content[index] = { type: 'text', text: '' };
      break;
    case 'text_delta':
      next.content[index] = {
        type: 'text',
        text: `${previous?.type === 'text' && typeof previous.text === 'string' ? previous.text : ''}${delta}`,
      };
      break;
    case 'text_end':
      next.content[index] = {
        type: 'text',
        text: typeof assistantMessageEvent.content === 'string'
          ? assistantMessageEvent.content
          : previous?.text ?? '',
      };
      break;
    case 'thinking_start':
      next.content[index] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta':
      next.content[index] = {
        type: 'thinking',
        thinking: `${previous?.type === 'thinking' && typeof previous.thinking === 'string' ? previous.thinking : ''}${delta}`,
      };
      break;
    case 'thinking_end':
      next.content[index] = {
        type: 'thinking',
        thinking: typeof assistantMessageEvent.content === 'string'
          ? assistantMessageEvent.content
          : previous?.thinking ?? '',
        ...(typeof assistantMessageEvent.contentSignature === 'string'
          ? { thinkingSignature: assistantMessageEvent.contentSignature }
          : {}),
      };
      break;
    case 'toolcall_start':
      next.content[index] = {
        type: 'toolCall',
        id: assistantMessageEvent.id,
        name: assistantMessageEvent.toolName,
        arguments: {},
        partialJson: '',
      };
      break;
    case 'toolcall_delta': {
      const partialJson = `${typeof previous?.partialJson === 'string' ? previous.partialJson : ''}${delta}`;
      let args: unknown = previous?.arguments ?? {};
      try { args = JSON.parse(partialJson); } catch { /* incomplete JSON is expected while streaming */ }
      next.content[index] = { ...previous, type: 'toolCall', partialJson, arguments: args };
      break;
    }
    case 'toolcall_end':
      if (isRecord(assistantMessageEvent.toolCall)) {
        next.content[index] = { ...assistantMessageEvent.toolCall };
      }
      break;
    default:
      return current;
  }
  return next;
}

/**
 * Produces a bounded live-display snapshot for an in-flight Pi tool call.
 * The full accumulator remains untouched and is still used by Pi to parse and
 * execute the tool once the input JSON is complete.
 */
export function getPiAssistantDisplaySnapshot(
  snapshot: PiAssistantSnapshot | undefined,
  assistantMessageEvent: unknown,
  maxPartialInputChars = DEFAULT_PARTIAL_TOOL_INPUT_PREVIEW_CHARS,
): PiAssistantSnapshot | undefined {
  if (!snapshot || !isRecord(assistantMessageEvent) || assistantMessageEvent.type !== 'toolcall_delta') {
    return snapshot;
  }
  const contentIndex = assistantMessageEvent.contentIndex;
  if (!Number.isInteger(contentIndex) || (contentIndex as number) < 0) return snapshot;
  const index = contentIndex as number;
  const block = snapshot.content[index];
  if (!isRecord(block) || block.type !== 'toolCall') return snapshot;

  const partialJson = typeof block.partialJson === 'string' ? block.partialJson : '';
  if (partialJson.length <= maxPartialInputChars) return snapshot;

  const preview = buildPartialToolInputPreview(partialJson, maxPartialInputChars);
  const content = snapshot.content.map((item, itemIndex) => itemIndex === index
    ? { ...item, arguments: preview, partialJson: preview }
    : item);
  return { ...snapshot, content };
}

export function getPiModelCompat(api: PiModelConfig['apiProtocol']):
  | { supportsDeveloperRole: false }
  | undefined {
  if ((api ?? 'openai-completions') !== 'openai-completions') return undefined;
  return { supportsDeveloperRole: false };
}

export function getPiAssistantError(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const record = message as Record<string, unknown>;
  if (record.role !== 'assistant' || record.stopReason !== 'error') return undefined;
  return typeof record.errorMessage === 'string' && record.errorMessage.trim()
    ? record.errorMessage
    : 'Pi model request failed';
}

export function getPiTranscriptRevision(messages: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

export function shouldCompletePiRun(
  activeRunId: string | undefined,
  settledRunId: string | undefined,
  promptRunId: string,
): boolean {
  return activeRunId === promptRunId && settledRunId === promptRunId;
}
