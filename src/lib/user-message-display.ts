/**
 * Normalize user message text for display and for optimistic↔server pairing.
 * Gateway history often stores injected hints/metadata; the UI stores stripped text.
 */
import { stripCronTriggerTextForDisplay } from '@/lib/cron-session-display';
import { stripDingTalkMentionContextForDisplay } from '@/lib/dingtalk-mention-context';
import { stripAgentMemoryContextsForDisplay } from '@/lib/agent-memory-display';
import { stripWorkflowCompleteForDisplay, stripWorkflowContextForDisplay } from '@/lib/workflow-context';
import { stripWorkflowSessionHintForDisplay } from '@/lib/workflow-session-hint';

const GATEWAY_SYSTEM_EVENT_LINE =
  /^\s*System:\s*(?:\[[^\]]+\]\s*)?[^\n]*(?:\n|$)/gim;

function stripGatewayUserMetadata(text: string): string {
  return text
    .replace(GATEWAY_SYSTEM_EVENT_LINE, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .replace(/\n*Current time:\s*[^\n]+/gi, '')
    .replace(/\n*Reference UTC:\s*[^\n]+/gi, '')
    .trim();
}

/** Collapse whitespace after stripping injected Gateway / client metadata. */
export function normalizeUserMessageForDisplay(text: string): string {
  const stripped = stripDingTalkMentionContextForDisplay(
    stripWorkflowCompleteForDisplay(
      stripWorkflowSessionHintForDisplay(
        stripAgentMemoryContextsForDisplay(
          stripWorkflowContextForDisplay(
            stripCronTriggerTextForDisplay(stripGatewayUserMetadata(text)),
          ),
        ),
      ),
    ),
  );
  return stripped.replace(/\s+/g, ' ').trim();
}
