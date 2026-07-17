import { appendWorkflowParameterFormToMessage } from './parameter-form-recovery';
import { getMessageText, isToolResultRole } from './helpers';
import type { ContentBlock, RawMessage } from './types';

export function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;
  const raw = message as unknown as Record<string, unknown>;
  const toolCalls = raw.tool_calls ?? raw.toolCalls;
  const hasOpenAiTools = Array.isArray(toolCalls) && toolCalls.length > 0;
  if (!Array.isArray(message.content)) {
    return hasOpenAiTools && !(typeof message.content === 'string' && message.content.trim());
  }
  let hasTool = hasOpenAiTools;
  let hasText = false;
  let hasNonToolContent = false;
  for (const block of message.content as ContentBlock[]) {
    if (['tool_use', 'tool_result', 'toolCall', 'toolResult'].includes(block.type)) {
      hasTool = true;
    } else if (block.type === 'text' && block.text?.trim()) {
      hasText = true;
    } else if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }
  return hasTool && !hasText && !hasNonToolContent;
}

export function maybeAppendWorkflowParameterForm(message: RawMessage): RawMessage {
  return appendWorkflowParameterFormToMessage(message, getMessageText, { allowLivePending: true }) ?? message;
}

export function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  return hasVisibleContent(message, true);
}

export function hasAssistantTextOutput(message: RawMessage | undefined): boolean {
  return hasVisibleContent(message, false);
}

function hasVisibleContent(message: RawMessage | undefined, includeThinking: boolean): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;
  if (Array.isArray(message.content)) {
    for (const block of message.content as ContentBlock[]) {
      if (block.type === 'text' && block.text?.trim()) return true;
      if (includeThinking && block.type === 'thinking' && block.thinking?.trim()) return true;
      if (block.type === 'image') return true;
    }
  }
  const raw = message as unknown as Record<string, unknown>;
  return typeof raw.text === 'string' && Boolean(raw.text.trim());
}
