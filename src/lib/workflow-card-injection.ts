import type { ContentBlock, RawMessage } from '@/stores/chat/types';

export const RUN_ID_IN_TEXT = /\b(run_[\w-]+)\b/gi;

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
    .map((block) => String((block as { text?: string }).text ?? ''))
    .join('\n');
}

function hasLegacyWorkflowCard(message: RawMessage): boolean {
  return Array.isArray(message.content)
    && (message.content as ContentBlock[]).some((block) => block.type === 'workflow_card');
}

/**
 * Parameter-form recovery still recognizes a legacy submitted turn. This is
 * intentionally not used to discover or render workflow progress cards.
 */
export function currentUserTurnHasWorkflowSubmission(
  messages: RawMessage[],
  getMessageText: (content: unknown) => string = assistantText,
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return false;

  return messages.slice(lastUserIndex + 1).some((message) => (
    message.role === 'assistant'
    && hasLegacyWorkflowCard(message)
    && /参数已确认/.test(getMessageText(message.content))
  ));
}
