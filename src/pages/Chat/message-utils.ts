/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import { useEffect, useMemo, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { sessionHasWorkflowExecution } from '@/stores/workflow-memory';
import { buildWorkflowFormConfig, buildWorkflowFormId } from '@/lib/workflow-form-utils';
import {
  PARAM_FORM_MARKER_REGEX,
  parseParameterFormMarker,
} from '@/lib/parameter-form-marker';
import { resolveParameterFormId } from '@/components/parameter-form/form-handlers';
import type { RawMessage, ContentBlock } from '@/stores/chat';
import {
  stripDingTalkAgentSendDisclaimerForDisplay,
  stripDingTalkMentionContextForDisplay,
} from '@/lib/dingtalk-mention-context';
import { stripCronTriggerTextForDisplay } from '@/lib/cron-session-display';
import { stripWorkflowContextForDisplay, stripWorkflowCompleteForDisplay, WORKFLOW_COMPLETE_TAG } from '@/lib/workflow-context';
import { stripWorkflowSessionHintForDisplay } from '@/lib/workflow-session-hint';
import {
  isWorkflowGuidanceAssistantText,
  isWorkflowParameterIntroText,
  isWorkflowParamsSummaryText,
  isWorkflowParamsUserText,
} from '@/lib/workflow-form-utils';
import {
  artifactToPreviewFile,
  extractPreviewableHttpUrls,
  inferMimeTypeFromUrl,
  isHttpUrl,
  isPreviewableArtifactUrl,
  isPreviewableRemoteUrl,
  resolveArtifactUrlFromWorkflowStates,
  toMarkdownPreviewPath,
} from '@/lib/preview-url';
import { normalizePreviewFileKey, previewFileRefsMatch } from '@/lib/preview-file-path';
import type { WorkflowExecutionState } from '@/types/workflow';

/** OpenClaw injects queued system events as `System: [timestamp] ...` lines before user text. */
const GATEWAY_SYSTEM_EVENT_LINE =
  /^\s*System:\s*(?:\[[^\]]+\]\s*)?[^\n]*(?:\n|$)/gim;

const AT_MENTION_DISPLAY_NAME_PATTERN = /@([^\s@\n]+)/g;

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: System event lines, [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  const cleaned = text
    // Remove OpenClaw system event lines (Exec completed/failed, cron, etc.)
    .replace(GATEWAY_SYSTEM_EVENT_LINE, '')
    // Remove [media attached: path (mime) | path] references
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    // Remove [message_id: uuid]
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    // Remove Gateway-injected "Conversation info (untrusted metadata): ```json...```" block
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    // Fallback: remove "Conversation info (...): {...}" without code block wrapper
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    // Remove Gateway timestamp prefix like [Fri 2026-02-13 22:39 GMT+8]
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    // OpenClaw cron jobs append "Current time: ..." (+ optional "Reference UTC: ...") to the prompt
    .replace(/\n*Current time:\s*[^\n]+/gi, '')
    .replace(/\n*Reference UTC:\s*[^\n]+/gi, '')
    .trim();
  return stripDingTalkMentionContextForDisplay(
    stripWorkflowCompleteForDisplay(
      stripWorkflowSessionHintForDisplay(
        stripWorkflowContextForDisplay(
          stripCronTriggerTextForDisplay(cleaned),
        ),
      ),
    ),
  );
}

/** Strip dws send metadata that agents should not surface to end users. */
const DWS_SEND_METADATA_PATTERN =
  /[,，]?\s*(?:\*\*)?(?:任务\s*ID|openTaskId|processQueryKey)(?:\*\*)?\s*[：:]\s*[A-Za-z0-9+/=_-]+(?:\*\*)?/gi;

const DWS_CLI_RECIPIENT_FLAG_NAMES =
  'user(?:-id)?|group(?:-id)?|space-id|open-conversation-id|conversation-id|cid';

/** Mask JSON-escaped quoted IDs, e.g. `--group \\"cidxxx\\"`. */
const DWS_CLI_RECIPIENT_JSON_ESCAPED_QUOTED_FLAG_PATTERN = new RegExp(
  `(--(?:${DWS_CLI_RECIPIENT_FLAG_NAMES})\\s+)(?:\\\\"|\\\\')(?:\\\\.|[^"\\\\])*?(?:\\\\"|\\\\')`,
  'gi',
);

/** Mask quoted recipient IDs in dws CLI flags, e.g. `--group "cidxxx"`. */
const DWS_CLI_RECIPIENT_QUOTED_FLAG_PATTERN = new RegExp(
  `(--(?:${DWS_CLI_RECIPIENT_FLAG_NAMES})\\s+)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
  'gi',
);

/** Mask unquoted recipient IDs in dws CLI flags. */
const DWS_CLI_RECIPIENT_FLAG_PATTERN = new RegExp(
  `(--(?:${DWS_CLI_RECIPIENT_FLAG_NAMES})\\s+)([^\\s"'\\\`,)]+)`,
  'gi',
);

/** Mask colon-separated recipient flags, e.g. `--user: 065212112421834`. */
const DWS_CLI_RECIPIENT_COLON_FLAG_PATTERN = new RegExp(
  `(--(?:${DWS_CLI_RECIPIENT_FLAG_NAMES})\\s*[:：]\\s*)([^\\s"'\\\`,)\\n]+)`,
  'gi',
);

/** Clean partial masks like `--group ***"cid..."` left after incomplete masking. */
const DWS_CLI_RECIPIENT_LEAKED_ID_PATTERN = new RegExp(
  `(--(?:${DWS_CLI_RECIPIENT_FLAG_NAMES})\\s+\\*+)\\s*(?:\\\\?["'])[A-Za-z0-9+/=_=-]{6,}(?:\\\\?["'])`,
  'gi',
);

const DWS_RECIPIENT_ID_FIELD_NAMES =
  'userId|userid|user[_\\s-]?id|openConversationId|open[_\\s-]?conversation[_\\s-]?id|conversation[_\\s-]?id|corpId|corp[_\\s-]?id|staffId|staff[_\\s-]?id|unionId|union[_\\s-]?id';

/** Mask structured recipient IDs echoed in thinking / tool output JSON. */
const DWS_JSON_RECIPIENT_FIELD_PATTERN = new RegExp(
  `("(?:${DWS_RECIPIENT_ID_FIELD_NAMES})"\\s*:\\s*)"([^"]*)"`,
  'gi',
);

/** Mask prose recipient IDs, e.g. `@文鹏 (userid: 0161271920846248)`. */
const DWS_PROSE_RECIPIENT_ID_IN_PARENS_PATTERN = new RegExp(
  `(\\(\\s*(?:${DWS_RECIPIENT_ID_FIELD_NAMES})\\s*[:：]\\s*)([^)\\s"'，,;]+)(\\s*\\))`,
  'gi',
);

/** Mask bare numeric / cid recipient IDs in parentheses, e.g. `JSON 块 (065212112421834)`. */
const DWS_BARE_RECIPIENT_ID_IN_PARENS_PATTERN =
  /\(\s*(\d{12,}|cid[A-Za-z0-9+/=_-]{8,})\s*\)/gi;

/** Mask quoted inline IDs, e.g. `userid: "0161271920846248"`. */
const DWS_PROSE_RECIPIENT_ID_QUOTED_INLINE_PATTERN = new RegExp(
  `((?<![\\w-])(?:${DWS_RECIPIENT_ID_FIELD_NAMES}|群\\s*[iI][dD]|群\\s*聊\\s*[iI][dD]|会话\\s*[iI][dD])\\s*[:：]\\s*)(["'])([A-Za-z0-9+/=_=-]{4,})\\2`,
  'gi',
);

/** Mask inline labeled IDs outside CLI flags, e.g. `userId:` / `群ID：cid...`. */
const DWS_PROSE_RECIPIENT_ID_INLINE_PATTERN = new RegExp(
  `((?<![\\w-])(?:${DWS_RECIPIENT_ID_FIELD_NAMES}|群\\s*[iI][dD]|群\\s*聊\\s*[iI][dD]|会话\\s*[iI][dD])\\s*[:：]\\s*)([A-Za-z0-9+/=_-]{6,})`,
  'gi',
);

/** Hide DingTalk user/group/corp IDs in display-only text (thinking, assistant reply, tool args). */
/** Raw message text without display cleaning (preserves DingTalk recipient JSON). */
export function extractRawMessageText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('\n');
  }
  if (typeof msg.text === 'string') return msg.text;
  return '';
}

/** Extract @ display names from user-visible message text. */
export function extractAtMentionDisplayNames(text: string): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const match of text.matchAll(AT_MENTION_DISPLAY_NAME_PATTERN)) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

export function maskDwsSensitiveIdsForDisplay(text: string): string {
  if (!text) return text;

  return text
    .replace(DWS_CLI_RECIPIENT_JSON_ESCAPED_QUOTED_FLAG_PATTERN, '$1***')
    .replace(DWS_CLI_RECIPIENT_QUOTED_FLAG_PATTERN, '$1***')
    .replace(DWS_CLI_RECIPIENT_FLAG_PATTERN, (match, flag: string, value: string) => {
      if (value.startsWith('***')) return match;
      return `${flag}***`;
    })
    .replace(DWS_CLI_RECIPIENT_COLON_FLAG_PATTERN, (match, flag: string, value: string) => {
      if (value.startsWith('***')) return match;
      return `${flag}***`;
    })
    .replace(DWS_CLI_RECIPIENT_LEAKED_ID_PATTERN, '$1')
    .replace(DWS_JSON_RECIPIENT_FIELD_PATTERN, '$1"***"')
    .replace(DWS_PROSE_RECIPIENT_ID_IN_PARENS_PATTERN, '$1***$3')
    .replace(DWS_PROSE_RECIPIENT_ID_QUOTED_INLINE_PATTERN, '$1***')
    .replace(DWS_PROSE_RECIPIENT_ID_INLINE_PATTERN, '$1***')
    .replace(DWS_BARE_RECIPIENT_ID_IN_PARENS_PATTERN, '(***)');
}

export function maskSensitiveToolInputForDisplay(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return maskDwsSensitiveIdsForDisplay(input);
  try {
    return maskDwsSensitiveIdsForDisplay(JSON.stringify(input, null, 2));
  } catch {
    return maskDwsSensitiveIdsForDisplay(String(input));
  }
}

export function stripDwsSendMetadataForDisplay(text: string): string {
  let cleaned = text
    .replace(DWS_SEND_METADATA_PATTERN, '')
    .replace(/^\s*(?:\*\*)?(?:任务\s*ID|openTaskId|processQueryKey)(?:\*\*)?\s*[：:]\s*[A-Za-z0-9+/=_-]+(?:\*\*)?\s*$/gim, '')
    .replace(/\*{4,}/g, '**');

  cleaned = cleaned
    .replace(/，\s*([。！？\n]|$)/g, '$1')
    .replace(/,\s*([.!?\n]|$)/g, '$1');

  return cleaned.trim();
}

function cleanDisplayText(text: string): string {
  return maskDwsSensitiveIdsForDisplay(
    stripDingTalkAgentSendDisclaimerForDisplay(stripDwsSendMetadataForDisplay(text)),
  );
}

function cleanAssistantText(text: string): string {
  return cleanDisplayText(text);
}

function cleanThinkingText(text: string): string {
  return cleanDisplayText(text);
}

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 * For user messages, strips Gateway-injected metadata.
 */
export {
  PARAM_FORM_MARKER_REGEX,
  parseParameterFormMarker,
  findParameterFormMarkerInMessage,
} from '@/lib/parameter-form-marker';

function rawMessageText(message: RawMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** Internal [workflow:complete] trigger — hidden from chat UI. */
export function isHiddenWorkflowCompleteUserMessage(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  return rawMessageText(message).includes(WORKFLOW_COMPLETE_TAG);
}

function isAssistantMessageRole(role: unknown): boolean {
  const normalized = typeof role === 'string' ? role.toLowerCase() : '';
  return normalized === 'assistant' || normalized === '';
}

export function messageHasWorkflowCard(msg: RawMessage): boolean {
  return Array.isArray(msg.content)
    && (msg.content as ContentBlock[]).some((block) => block.type === 'workflow_card');
}

function messageHasParameterFormBlock(msg: RawMessage): boolean {
  return Array.isArray(msg.content)
    && (msg.content as ContentBlock[]).some((block) => block.type === 'parameter_form');
}

/** 工作流 intro / 分组参数摘要（与后续 workflow_card 执行卡分开展示） */
export function isWorkflowPreambleAssistantMessage(msg: RawMessage): boolean {
  if (!isAssistantMessageRole(msg.role)) return false;
  const text = extractText(msg).trim();
  if (isWorkflowParamsSummaryText(text)) return true;
  if (isWorkflowGuidanceAssistantText(text)) return true;
  if (isWorkflowParameterIntroText(text)) return true;
  if (messageHasParameterFormBlock(msg)) return true;
  return false;
}

/**
 * 方案 A fallback：旧会话 intro 未 patch 时，从后续用户摘要取分组参数正文。
 */
export function findWorkflowParamsSummaryAfterIntro(
  messages: RawMessage[],
  introIndex: number,
): string | null {
  for (let i = introIndex + 1; i < messages.length; i += 1) {
    const current = messages[i];
    if (current.role === 'user' && isWorkflowParamsUserText(rawMessageText(current))) {
      return rawMessageText(current);
    }
    if (isAssistantMessageRole(current.role) && messageHasWorkflowCard(current)) break;
    if (current.role === 'user') break;
  }
  return null;
}

/** 隐藏已被 intro 承接的用户参数摘要，或紧挨「参数已确认」执行卡前的冗余用户气泡。 */
export function isHiddenWorkflowParamsUserMessage(
  message: RawMessage,
  messages: RawMessage[],
  index: number,
): boolean {
  if (message.role !== 'user') return false;
  if (!isWorkflowParamsUserText(rawMessageText(message))) return false;

  const next = messages[index + 1];
  if (!next || !messageHasWorkflowCard(next)) return false;

  // 下一条已是「参数已确认」折叠块时，用户侧 fallback（如「启动工作流「xxx」」）无需再展示
  if (isAssistantMessageRole(next.role) && /参数已确认/.test(rawMessageText(next))) {
    return true;
  }

  for (let j = index - 1; j >= 0; j -= 1) {
    const prior = messages[j];
    if (prior.role === 'user') break;
    if (!isAssistantMessageRole(prior.role)) continue;
    const assistantText = rawMessageText(prior);
    if (isWorkflowParamsSummaryText(assistantText)) return true;
    if (isWorkflowParameterIntroText(assistantText)) return true;
  }

  return false;
}

/**
 * 同一段连续助手消息内，仅保留最后一条工作流 preamble（去重流式重复 intro / 参数摘要）。
 */
export function isHiddenDuplicateWorkflowPreambleAssistantMessage(
  message: RawMessage,
  messages: RawMessage[],
  index: number,
): boolean {
  if (!isWorkflowPreambleAssistantMessage(message)) return false;

  for (let j = index + 1; j < messages.length; j += 1) {
    const next = messages[j];
    if (next.role === 'user') break;
    if (messageHasWorkflowCard(next)) break;
    if (!isAssistantMessageRole(next.role)) continue;
    if (isWorkflowPreambleAssistantMessage(next)) return true;
  }

  const text = rawMessageText(message).trim();
  if (!isWorkflowParamsSummaryText(text)) return false;

  for (let j = index - 1; j >= 0; j -= 1) {
    const prior = messages[j];
    if (prior.role === 'user') break;
    if (!isAssistantMessageRole(prior.role)) continue;
    if (messageHasWorkflowCard(prior)) break;
    if (rawMessageText(prior).trim() === text) return true;
  }

  return false;
}

type PendingWorkflowSnapshot = {
  templateId: string;
  schema?: import('@/types/workflow').WorkflowSchema;
  collectedInputs?: Record<string, unknown>;
} | null;

export function extractParameterForm(
  message: RawMessage | unknown,
  pendingOverride?: PendingWorkflowSnapshot,
): {
  formId: string;
  formConfig: import('@/types/user-form').UserFormConfig;
  formContext: { source: 'workflow' | 'tool' | 'skill'; sourceId: string; schemaHash?: string };
} | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  for (const block of content as import('@/stores/chat').ContentBlock[]) {
    // First check for native parameter_form block type
    if (
      block.type === 'parameter_form' &&
      (block as any).formId &&
      (block as any).formConfig &&
      (block as any).formContext
    ) {
      const formId = (block as any).formId;
      const formContext = (block as any).formContext as {
        source: 'workflow' | 'tool' | 'skill';
        sourceId: string;
        schemaHash?: string;
      };
      if (
        formContext.source === 'workflow'
        && formContext.sourceId
        && sessionHasWorkflowExecution(useChatStore.getState().currentSessionKey, formContext.sourceId)
      ) {
        return null;
      }
      
      return {
        formId,
        formConfig: (block as any).formConfig as import('@/types/user-form').UserFormConfig,
        formContext,
      };
    }

    // Check for <ParameterForm ... /> marker in text blocks
    if (block.type === 'text' && typeof block.text === 'string') {
      const parsed = parseParameterFormMarker(block.text);
      if (parsed) {
        const { templateId, schemaHash } = parsed;
        const sessionKey = useChatStore.getState().currentSessionKey;
        if (sessionHasWorkflowExecution(sessionKey, templateId)) {
          return null;
        }

        const pendingWorkflow =
          pendingOverride ?? useChatStore.getState().pendingWorkflow;
        if (
          !pendingWorkflow
          || pendingWorkflow.templateId !== templateId
          || !pendingWorkflow.schema
        ) {
          return null;
        }

        return {
          formId: resolveParameterFormId(buildWorkflowFormId(templateId)),
          formConfig: buildWorkflowFormConfig(
            pendingWorkflow.schema,
            '',
            pendingWorkflow.collectedInputs,
            {
              templateId,
              schemaHash,
            },
          ),
          formContext: {
            source: 'workflow',
            sourceId: templateId,
            schemaHash,
          },
        };
      }
    }
  }
  return null;
}

/**
 * Extract workflow_card block from a message's content field.
 */
export function extractWorkflowCard(message: RawMessage | unknown): { runId: string; templateName: string } | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  let latest: { runId: string; templateName: string } | null = null;
  for (const block of content as import('@/stores/chat').ContentBlock[]) {
    if (block.type === 'workflow_card' && block.runId) {
      latest = {
        runId: block.runId,
        templateName: block.templateName ?? '工作流',
      };
    }
  }
  return latest;
}

/** Latest workflow_card across assistant snapshots in a turn (newest message / block wins). */
export function findLatestWorkflowCardInMessages(
  messages: RawMessage[],
): { runId: string; templateName: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = extractWorkflowCard(messages[i]);
    if (card) return card;
  }
  return null;
}

export function extractPlainTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  const isUser = role === 'user';

  let result = '';

  if (typeof content === 'string') {
    result = content.trim().length > 0 ? content : '';
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text) {
        if (block.text.trim().length > 0) {
          parts.push(block.text);
        }
      }
    }
    const combined = parts.join('\n\n');
    result = combined.trim().length > 0 ? combined : '';
  } else if (typeof msg.text === 'string') {
    // Fallback: try .text field
    result = msg.text.trim().length > 0 ? msg.text : '';
  }

  // Strip <ParameterForm ... /> marker from text for clean display
  if (result) {
    result = result.replace(PARAM_FORM_MARKER_REGEX, '').trim();
  }

  // Strip Gateway metadata from user messages for clean display
  if (isUser && result) {
    result = cleanUserText(result);
  }

  if (role === 'assistant' && result) {
    result = cleanAssistantText(result);
  }

  return result;
}

/**
 * Extract thinking/reasoning content from a message.
 * Returns null if no thinking content found.
 */
export function extractThinking(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      const cleaned = cleanThinkingText(block.thinking.trim());
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }

  const combined = parts.join('\n\n').trim();
  return combined.length > 0 ? combined : null;
}

export type ThinkingTimelineItem =
  | { type: 'thinking'; content: string }
  | { type: 'tool'; index: number; id: string; name: string; input: unknown };

/**
 * Ordered thinking + tool_use segments from message content (preserves block order).
 */
export function extractThinkingTimeline(message: RawMessage | unknown): ThinkingTimelineItem[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  const items: ThinkingTimelineItem[] = [];
  let toolIndex = 0;

  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'thinking' && block.thinking) {
        const cleaned = cleanThinkingText(block.thinking.trim());
        if (cleaned) {
          items.push({ type: 'thinking', content: cleaned });
        }
      } else if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        toolIndex += 1;
        items.push({
          type: 'tool',
          index: toolIndex,
          id: block.id || `tool-${toolIndex}`,
          name: block.name,
          input: block.input ?? block.arguments,
        });
      }
    }
  }

  if (items.length === 0) {
    const thinking = extractThinking(message);
    if (thinking) {
      items.push({ type: 'thinking', content: thinking });
    }
    const tools = extractToolUse(message);
    for (const tool of tools) {
      toolIndex += 1;
      items.push({
        type: 'tool',
        index: toolIndex,
        id: tool.id || `tool-${toolIndex}`,
        name: tool.name,
        input: tool.input,
      });
    }
  }

  return items;
}

/**
 * Extract media file references from Gateway-formatted user message text.
 * Returns array of { filePath, mimeType } from [media attached: path (mime) | path] patterns.
 */
export function extractMediaRefs(message: RawMessage | unknown): Array<{ filePath: string; mimeType: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'user') return [];
  const content = msg.content;

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as ContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }

  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/**
 * Extract image attachments from a message.
 * Returns array of { mimeType, data } for base64 images.
 */
export function extractImages(message: RawMessage | unknown): Array<{ mimeType: string; data: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format
      if (block.source) {
        const src = block.source;
        if (src.type === 'base64' && src.media_type && src.data) {
          images.push({ mimeType: src.media_type, data: src.data });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        images.push({ mimeType: block.mimeType || 'image/jpeg', data: block.data });
      }
    }
  }

  return images;
}

/**
 * Extract tool use blocks from a message.
 * Handles both Anthropic format (tool_use in content array) and
 * OpenAI format (tool_calls array on the message object).
 */
export function extractToolUse(message: RawMessage | unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const tools: Array<{ id: string; name: string; input: unknown }> = [];

  // Path 1: Anthropic/normalized format — tool_use / toolCall blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        tools.push({
          id: block.id || '',
          name: block.name,
          input: block.input ?? block.arguments,
        });
      }
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  // Real-time streaming events from OpenAI-compatible models (DeepSeek, etc.)
  // use this format; the Gateway normalizes to Path 1 when storing history.
  if (tools.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        let input: unknown;
        try {
          input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments ?? fn.input;
        } catch {
          input = fn.arguments;
        }
        tools.push({
          id: typeof tc.id === 'string' ? tc.id : '',
          name,
          input,
        });
      }
    }
  }

  return tools;
}

/**
 * Determine if an attached file is previewable in the side panel.
 * Covers: text, code, data, Office docs (fallback/external-open).
 */
const PREVIEWABLE_MIME_PREFIXES = [
  'text/html',
  'text/plain',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
  'application/pdf',
  'text/markdown',
  // Office docs — currently shown as "open externally" placeholder,
  // but listed so users can click them in the product panel.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];

export function isPreviewableFile(file: { mimeType: string; filePath?: string; type?: string }): boolean {
  if (!file.filePath) return false;
  if (isHttpUrl(file.filePath)) {
    return isPreviewableRemoteUrl(file.filePath, file.type ?? file.mimeType);
  }
  if (file.filePath.startsWith('artifact://')) return false;
  const ext = file.filePath.split('.').pop()?.toLowerCase() || '';
  const matched = PREVIEWABLE_MIME_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? file.mimeType.startsWith(prefix) : file.mimeType === prefix,
  );
  if (matched) return true;
  // Fallback: known extensions whose MIME may be application/octet-stream
  return ['html', 'htm', 'pdf', 'md', 'txt', 'json', 'csv', 'tsv',
    'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt'].includes(ext);
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    pdf: 'application/pdf',
    md: 'text/markdown', txt: 'text/plain',
    json: 'application/json', csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Code files
    sql: 'text/plain', py: 'text/plain', js: 'text/plain', ts: 'text/plain',
    jsx: 'text/plain', tsx: 'text/plain', java: 'text/plain', go: 'text/plain',
    rs: 'text/plain', cpp: 'text/plain', c: 'text/plain', h: 'text/plain',
    cs: 'text/plain', rb: 'text/plain', php: 'text/plain', swift: 'text/plain',
    kt: 'text/plain', scala: 'text/plain', r: 'text/plain', m: 'text/plain', mm: 'text/plain',
    // Config files
    yaml: 'text/plain', yml: 'text/plain', xml: 'text/plain', toml: 'text/plain',
    ini: 'text/plain', conf: 'text/plain', properties: 'text/plain', env: 'text/plain',
    // Data/Log files
    log: 'text/plain', tsv: 'text/tab-separated-values',
    // Web files
    css: 'text/plain', scss: 'text/plain', less: 'text/plain',
    // Shell scripts
    sh: 'text/plain', bash: 'text/plain', zsh: 'text/plain', fish: 'text/plain',
    ps1: 'text/plain', bat: 'text/plain', cmd: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

import { PREVIEWABLE_FILE_EXT_PATTERN } from '../../../shared/artifact-path';

/** Shared extension list for previewable local file paths (used by extractPreviewableRefs and preprocessTextForPreviewLinks). */
export const PREVIEWABLE_FILE_EXTS = PREVIEWABLE_FILE_EXT_PATTERN;

/** Match a single line that is only a previewable file path (relative, absolute, or Windows). */
export const PREVIEWABLE_PATH_LINE_REGEX = new RegExp(
  `^(?:\\./(?:[^/\\n\\r]+/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|/(?:[^/\\n\\r]+/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|[A-Za-z]:[\\\\/](?:[^/\\n\\r]+[\\\\/])*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS}))$`,
  'i',
);

/** Strip list markers / emoji prefixes so `- 📁 /path` is recognized as a path line. */
export function normalizePreviewPathLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^[^\s/\\.`[\]()]+\s+/, '') // emoji or short label prefix before path
    .trim();
}

/** Strip markdown/code wrapping around an extracted path segment. */
function stripPathWrapping(path: string): string {
  return path.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
}

/** Label colon for "报告文件：`C:\...`" — avoid treating Windows `C:` as the separator. */
function findLabelColonIndex(text: string): number {
  const fullWidth = text.lastIndexOf('：');
  if (fullWidth >= 0) return fullWidth;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] !== ':') continue;
    const prev = text[i - 1];
    const next = text[i + 1];
    if (prev && /[A-Za-z]/.test(prev) && next && /[\\/]/.test(next)) continue;
    return i;
  }
  return -1;
}

function extractPathCandidateFromLine(line: string): string | null {
  let trimmed = normalizePreviewPathLine(line);
  if (!trimmed) return null;

  const colonIdx = findLabelColonIndex(trimmed);
  if (colonIdx >= 0) {
    const afterColon = stripPathWrapping(trimmed.slice(colonIdx + 1));
    if (
      afterColon.startsWith('/')
      || afterColon.startsWith('./')
      || /^[A-Za-z]:[\\/]/.test(afterColon)
    ) {
      trimmed = afterColon;
    }
  }

  trimmed = stripPathWrapping(trimmed);
  if (trimmed.startsWith('file://')) {
    trimmed = trimmed.slice('file://'.length).replace(/^\/([A-Za-z]:)/, '$1');
  }
  return PREVIEWABLE_PATH_LINE_REGEX.test(trimmed) ? trimmed : null;
}

export function isPreviewablePathLine(line: string): boolean {
  return extractPathCandidateFromLine(line) !== null;
}

export function extractPreviewPathFromLine(line: string): string | null {
  return extractPathCandidateFromLine(line);
}

/** Markdown link for a local/remote previewable path. */
export function previewMarkdownLinkForPath(filePath: string): string {
  const path = filePath.trim();
  const safe = toMarkdownPreviewPath(path);
  const fileName = safe.split('/').pop() || safe;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return `[${fileName}](${path})`;
  }
  return `[${fileName}](preview://${safe})`;
}

/**
 * Unwrap AI code blocks / inline code that contain only file paths into preview links.
 * Models often wrap path lists in ``` fences or `backticks`, which blocks normal path detection.
 */
export function unwrapPreviewablePathMarkdown(text: string): string {
  // Fenced blocks: ``` optional-lang + newline + path lines + ```
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (match, inner: string) => {
    const lines = inner.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || !lines.every(isPreviewablePathLine)) return match;
    return lines
      .map((line) => {
        const path = extractPreviewPathFromLine(line);
        return path ? `- ${previewMarkdownLinkForPath(path)}` : line;
      })
      .join('\n');
  });

  // Inline `path` — models often wrap a single absolute path in backticks.
  text = text.replace(/`([^`\n]+)`/g, (match, inner: string) => {
    const path = extractPreviewPathFromLine(inner);
    if (!path) return match;
    return previewMarkdownLinkForPath(path);
  });

  return linkifyPreviewPathLines(text);
}

/** Turn plain path lines (lists, emoji prefixes, "链接：/path") into preview markdown links. */
export function linkifyPreviewPathLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!isPreviewablePathLine(line)) return line;
      const path = extractPreviewPathFromLine(line);
      return path ? previewMarkdownLinkForPath(path) : line;
    })
    .join('\n');
}

/** Remove fenced code blocks from text so paths inside them are not matched. */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

function extractPathsFromPathOnlyCodeBlocks(text: string): string[] {
  const paths: string[] = [];
  text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, inner: string) => {
    const lines = inner.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every(isPreviewablePathLine)) {
      for (const line of lines) {
        const path = extractPreviewPathFromLine(line);
        if (path) paths.push(path);
      }
    }
    return _match;
  });
  text.replace(/`([^`\n]+)`/g, (_match, inner: string) => {
    const path = extractPreviewPathFromLine(inner);
    if (path) paths.push(path);
    return _match;
  });
  return paths;
}

/**
 * Extract previewable local file paths, file:// URLs, and localhost URLs from plain text.
 * Matches absolute paths like /Users/.../file.html, file:///Users/.../file.html,
 * and localhost URLs like http://localhost:8080/path.
 * Code blocks are stripped before matching to avoid false positives.
 * Lookbehind rejects URL path components (e.g. /report.html inside https://example.com/report.html).
 */
export function extractPreviewableRefs(text: string): Array<{ filePath: string; fileName: string; mimeType: string }> {
  const cleanText = stripCodeBlocks(text);
  const results: Array<{ filePath: string; fileName: string; mimeType: string }> = [];
  const seen = new Set<string>();

  for (const path of extractPathsFromPathOnlyCodeBlocks(text)) {
    const fileName = path.split(/[\\/]/).pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (fileName && ext) {
      const mimeType = extToMimeType(ext);
      if (!mimeType.startsWith('image/')) {
        const key = normalizePreviewFileKey(path, fileName);
        if (key && !seen.has(key)) {
          seen.add(key);
          results.push({ filePath: path, fileName, mimeType });
        }
      }
    }
  }

  for (const line of text.split('\n')) {
    const path = extractPreviewPathFromLine(line);
    if (!path) continue;
    const fileName = path.split(/[\\/]/).pop() || '';
    const key = normalizePreviewFileKey(path, fileName);
    if (!key || seen.has(key)) continue;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (!ext) continue;
    const mimeType = extToMimeType(ext);
    if (mimeType.startsWith('image/')) continue;
    seen.add(key);
    results.push({ filePath: path, fileName, mimeType });
  }

  function addIfNotImage(filePath: string, fileName: string, ext: string) {
    const mimeType = extToMimeType(ext);
    if (mimeType.startsWith('image/')) return;
    const key = normalizePreviewFileKey(filePath, fileName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push({ filePath, fileName, mimeType });
  }

  // file:// URLs — strip the scheme and use the underlying local path
  // Regex consumes file:// (2 slashes), capture group gets the 3rd slash + path.
  // For Windows: /C:/Users/... → strip leading / → C:/Users/...
  // For Unix: /Users/... → keep as-is → /Users/...
  const fileUrlRegex = /file:\/\/(\/[A-Za-z]:[\\/][^\s)\]"',;<>]+|\/[^\s)\]"',;<>]+)/g;
  let match;
  while ((match = fileUrlRegex.exec(cleanText)) !== null) {
    const captured = match[1];
    // Strip leading / for Windows paths (/C:/ → C:/), keep for Unix (/Users/ → /Users/)
    const filePath = captured.match(/^\/[A-Za-z]:/) ? captured.slice(1) : captured;
    const fileName = filePath.split('/').pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(filePath, fileName, ext);
  }

  // Localhost URLs (previewable in side panel)
  const urlRegex = /(https?:\/\/localhost:[^\s)\]"',;<>]+)/g;
  while ((match = urlRegex.exec(cleanText)) !== null) {
    const url = match[1];
    const fileName = url.split('/').pop() || 'index.html';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(url, fileName, ext);
  }

  // OSS / CDN http(s) links with previewable extensions
  for (const ref of extractPreviewableHttpUrls(cleanText)) {
    addIfNotImage(ref.filePath, ref.fileName, ref.fileName.split('.').pop()?.toLowerCase() || '');
  }

  // File paths (relative ./, absolute /, and Windows C:\) — support code, config, doc, and web files
  // Lookbehind (?<![\\w./:]) rejects matches that are part of a URL path component
  const pathRegex = new RegExp(
    `(?<![\\w./:])(\\./(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|\\/(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|[A-Za-z]:[\\\\/](?:[^/\\n\\r]+[\\\\/])*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS}))`,
    'gi',
  );
  while ((match = pathRegex.exec(cleanText)) !== null) {
    const path = match[1].replace(/\\/g, '/');
    const fileName = path.split(/[\\/]/).pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(path, fileName, ext);
  }

  return results;
}

// ── Local path existence verification ────────────────────────────
// Text-extracted paths may point at cloud-runtime locations (e.g. /runtime/outputs/x.html)
// that do not exist on the user's machine. Verify before rendering preview entries.

/** Module-level cache so the same path is stat-ed at most once per app session. */
const _pathExistsCache = new Map<string, boolean>();

/**
 * Batch-verify local (non-http) paths via /api/files/stat.
 * Returns a map of path → exists; paths still being verified are absent from the map.
 * On transport failure paths are marked as existing (fail-open, preserves legacy behavior).
 */
export function useLocalPathExistence(paths: string[]): Record<string, boolean> {
  const key = paths.join('\n');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unknown = paths.filter((p) => !_pathExistsCache.has(p));
    if (unknown.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await hostApiFetch<{ exists: Record<string, boolean> }>('/api/files/stat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: unknown }),
        });
        for (const p of unknown) {
          _pathExistsCache.set(p, res?.exists?.[p] === true);
        }
      } catch {
        for (const p of unknown) _pathExistsCache.set(p, true);
      }
      if (!cancelled) setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const p of paths) {
      const v = _pathExistsCache.get(p);
      if (v !== undefined) out[p] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

/**
 * Resolve a non-http candidate path to its final previewable form:
 * - exists locally → keep the local path;
 * - doesn't exist (cloud-runtime path) → map to the matching artifact OSS URL by basename;
 * - unresolvable → null (do not render a preview entry).
 */
export function resolvePreviewCandidate(
  file: { mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null },
  exists: boolean | undefined,
  workflowCardStates?: Record<string, WorkflowExecutionState>,
): { mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null } | null {
  if (isHttpUrl(file.filePath)) return file;
  if (exists === true) return file;
  if (exists === undefined) return null; // verification pending
  const resolved = resolveArtifactUrlFromWorkflowStates(file.filePath, workflowCardStates ?? {});
  if (resolved && isHttpUrl(resolved)) {
    return {
      ...file,
      filePath: resolved,
      mimeType: inferMimeTypeFromUrl(resolved, file.mimeType),
    };
  }
  return null;
}

/**
 * Extract previewable files from an array of messages.
 * Includes both _attachedFiles and references found in message text.
 */
export function usePreviewableFiles(
  messages: Array<unknown & { _attachedFiles?: Array<{ mimeType: string; filePath?: string; fileName: string }>; content?: unknown; role?: string }>,
  workflowCardStates?: Record<string, WorkflowExecutionState>,
) {
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null }> = [];

    function addItem(item: { mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null }) {
      const key = normalizePreviewFileKey(item.filePath, item.fileName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(item);
    }

    // Structured workflow artifacts first — authoritative OSS URLs win dedup.
    if (workflowCardStates) {
      for (const state of Object.values(workflowCardStates)) {
        for (const artifact of state.result?.artifacts ?? []) {
          if (!isPreviewableArtifactUrl(artifact.url, artifact.type)) continue;
          const previewFile = artifactToPreviewFile(artifact);
          if (!previewFile.filePath) continue;
          addItem({
            mimeType: previewFile.mimeType,
            filePath: previewFile.filePath,
            fileName: previewFile.fileName,
            fileSize: previewFile.fileSize,
            preview: previewFile.preview,
          });
        }
      }
    }

    for (const msg of messages) {
      // Path 1: explicit attached files
      // Skip user-uploaded attachments (role === 'user'); only show AI-generated outputs
      if (msg._attachedFiles && msg.role !== 'user') {
        for (const file of msg._attachedFiles) {
          if (!isPreviewableFile(file)) continue;
          const fp = file.filePath || file.fileName;
          if (!fp) continue;
          addItem({
            mimeType: file.mimeType,
            filePath: fp,
            fileName: file.fileName,
            fileSize: (file as { fileSize?: number }).fileSize ?? 0,
            preview: (file as { preview?: string | null }).preview ?? null,
          });
        }
      }

      // Path 2: references in message text (from assistant/tool outputs)
      const text = extractText(msg);
      if (text) {
        const refs = extractPreviewableRefs(text);
        for (const ref of refs) {
          if (msg._attachedFiles?.some((f) => previewFileRefsMatch(f, ref))) continue;
          addItem({
            mimeType: ref.mimeType,
            filePath: ref.filePath,
            fileName: ref.fileName,
            fileSize: 0,
            preview: null,
          });
        }
      }
    }

    return result;
  }, [messages, workflowCardStates]);

  // Verify non-http candidates against the local filesystem; cloud-runtime paths
  // resolve to their artifact OSS URL or are dropped (never rendered as broken cards).
  const localPaths = useMemo(
    () => candidates.filter((f) => !isHttpUrl(f.filePath)).map((f) => f.filePath),
    [candidates],
  );
  const existence = useLocalPathExistence(localPaths);

  return useMemo(() => {
    const seen = new Set<string>();
    const result: typeof candidates = [];
    for (const file of candidates) {
      const resolved = resolvePreviewCandidate(file, existence[file.filePath], workflowCardStates);
      if (!resolved) continue;
      const key = normalizePreviewFileKey(resolved.filePath, resolved.fileName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(resolved);
    }
    return result;
  }, [candidates, existence, workflowCardStates]);
}

/**
 * Format a Unix timestamp (seconds) to relative time string.
 */
export function formatTimestamp(timestamp: unknown): string {
  if (!timestamp) return '';
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!ts || isNaN(ts)) return '';

  // OpenClaw timestamps can be in seconds or milliseconds
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60000) return '刚刚';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} 小时前`;

  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
