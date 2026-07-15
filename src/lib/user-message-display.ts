/**
 * Normalize user message text for display and for optimistic↔server pairing.
 * Gateway history often stores injected hints/metadata; the UI stores stripped text.
 */
import { stripCronTriggerTextForDisplay } from '@/lib/cron-session-display';
import { stripDingTalkMentionContextForDisplay } from '@/lib/dingtalk-mention-context';
import { stripSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import { stripWorkflowCompleteForDisplay, stripWorkflowContextForDisplay } from '@/lib/workflow-context';
import { stripSclawBrowserEmbedContextForDisplay } from '@/lib/sclaw-browser-embed-context';
import { stripWorkflowSessionHintForDisplay } from '@/lib/workflow-session-hint';

const GATEWAY_SYSTEM_EVENT_LINE =
  /^\s*System:\s*(?:\[[^\]]+\]\s*)?[^\n]*(?:\n|$)/gim;

function stripGatewayUserMetadata(text: string): string {
  return text
    .replace(GATEWAY_SYSTEM_EVENT_LINE, '')
    .replace(/^Sender\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/im, '')
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
        stripSclawBrowserEmbedContextForDisplay(
          stripWorkflowContextForDisplay(
            stripCronTriggerTextForDisplay(
              stripSkillTranscriptMarker(stripGatewayUserMetadata(text)),
            ),
          ),
        ),
      ),
    ),
  );
  return stripped.replace(/\s+/g, ' ').trim();
}

/** Strip Gateway metadata for skill transcript parsing; preserve newlines for prompt/user split. */
export function stripGatewayUserMetadataPreservingLines(text: string): string {
  return stripDingTalkMentionContextForDisplay(
    stripWorkflowCompleteForDisplay(
      stripWorkflowSessionHintForDisplay(
        stripWorkflowContextForDisplay(
          stripCronTriggerTextForDisplay(
            stripSkillTranscriptMarker(stripGatewayUserMetadata(text)),
          ),
        ),
      ),
    ),
  ).trim();
}
