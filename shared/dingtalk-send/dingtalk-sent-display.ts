import {
  DINGTALK_AGENT_SEND_DISCLAIMER_MARKER,
  DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT,
  stripDingTalkAgentSendDisclaimerBody,
} from '../dingtalk-prompts/dingtalk-disclaimer';
import { messageHasDingTalkRecipientContext } from '../dingtalk-prompts/dingtalk-mention-context';
import { parseDwsSendTextFlagSegment, unescapeLiteralDwsSendText } from './dws-send-text';

export interface DingTalkSentDisplayMessage {
  role?: string;
  content?: unknown;
  toolCallId?: string;
  isError?: boolean;
  tool_calls?: unknown;
  toolCalls?: unknown;
}

export type DingTalkSentRecipientKind = 'user' | 'group' | 'unknown';

export interface DingTalkSentMessagePreview {
  toolCallId?: string;
  recipientKind: DingTalkSentRecipientKind;
  recipientLabel: string;
  title?: string;
  /** Full --text payload sent to DingTalk (incl. disclaimer footer). */
  text: string;
}

const DWS_SEND_CMD = /dws\s+chat\s+message\s+send\b/i;

const GENERIC_RECIPIENT_LABELS = new Set(['联系人', '群聊', '钉钉']);

export interface DingTalkRecipientLookup {
  byUserId: Map<string, string>;
  byGroupId: Map<string, string>;
}

export interface DingTalkSentPreviewOptions {
  /** Display names from the user's @ mentions in the same turn, e.g. `文鹏`. */
  mentionHints?: string[];
  /** Raw user message (may include StoClaw DingTalk recipient JSON). */
  userMessageRaw?: string;
  /** Assistant reply text — fallback for names like `发送给「自研Claw」群`. */
  assistantReplyText?: string;
}

function emptyRecipientLookup(): DingTalkRecipientLookup {
  return { byUserId: new Map(), byGroupId: new Map() };
}

/** Parse @-selected recipients from the injected StoClaw user-message block. */
export function extractDingTalkRecipientLookup(rawMessage?: string): DingTalkRecipientLookup {
  const lookup = emptyRecipientLookup();
  if (!rawMessage?.trim() || !messageHasDingTalkRecipientContext(rawMessage)) {
    return lookup;
  }

  const jsonMatch = rawMessage.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!jsonMatch?.[1]) return lookup;

  try {
    const payload = JSON.parse(jsonMatch[1]) as {
      recipients?: Array<{
        type?: string;
        displayName?: string;
        userId?: string;
        openConversationId?: string;
      }>;
    };
    for (const recipient of payload.recipients ?? []) {
      const name = recipient.displayName?.trim();
      if (!name) continue;
      if (recipient.type === 'user' && recipient.userId?.trim()) {
        lookup.byUserId.set(recipient.userId.trim(), name);
      }
      if (recipient.type === 'group' && recipient.openConversationId?.trim()) {
        lookup.byGroupId.set(recipient.openConversationId.trim(), name);
      }
    }
  } catch {
    // ignore malformed JSON
  }

  return lookup;
}

function extractRecipientNameFromAssistantReply(
  replyText: string | undefined,
  kind: 'group' | 'user',
): string | undefined {
  if (!replyText?.trim()) return undefined;
  if (kind === 'group') {
    const groupMatch = replyText.match(/发送给[「"]([^」"]+)[」"]\s*群/);
    if (groupMatch?.[1]?.trim()) return groupMatch[1].trim();
    const toGroupMatch = replyText.match(/给[「"]([^」"]+)[」"]\s*群/);
    if (toGroupMatch?.[1]?.trim()) return toGroupMatch[1].trim();
    return undefined;
  }
  const userMatch = replyText.match(/发送给\s*@?([^\s，,。！!？?\n「」"]+)/);
  if (userMatch?.[1]?.trim()) return userMatch[1].trim();
  return undefined;
}

function readToolInputCommand(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script', 'bash_command', 'input']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function readFlag(command: string, flag: string): string | undefined {
  const re = new RegExp(`--${flag}\\s+(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|(\\S+))`, 'i');
  const match = command.match(re);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

function appendEscapedChar(out: string, ch: string): string {
  switch (ch) {
    case 'n':
      return `${out}\n`;
    case 't':
      return `${out}\t`;
    case 'r':
      return `${out}\r`;
    case '"':
      return `${out}"`;
    case "'":
      return `${out}'`;
    case '\\':
      return `${out}\\`;
    default:
      return `${out}${ch}`;
  }
}

function parseQuotedValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return trimmed;
  let escaped = false;
  let out = '';
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      out = appendEscapedChar(out, ch);
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return out;
}

function parseTextFlag(command: string): string | undefined {
  const match = command.match(
    /--text\s+([\s\S]*?)(?=\s+--(?:format|uuid|dry-run|media|msg-type|dentry-id|space-id|file-name|file-type|file-path|file-size|open-dingtalk-id)\b|$)/i,
  );
  if (!match) return undefined;
  const parsed = parseDwsSendTextFlagSegment(match[1]);
  if (!parsed?.trim()) return undefined;
  return unescapeLiteralDwsSendText(parsed);
}

function previewDedupeKey(parsed: Omit<DingTalkSentMessagePreview, 'toolCallId'>): string {
  const body = stripDingTalkAgentSendDisclaimerBody(parsed.text)
    .replace(/\s+/g, ' ')
    .trim();
  return `${parsed.recipientLabel}\0${body}`;
}

/** Prefer file / image sends over plain text when body + recipient are the same. */
function dwsSendRichness(command: string): number {
  if (/--msg-type\s+file\b/i.test(command)) return 3;
  if (/--msg-type\s+image\b/i.test(command) || /\s--media\s+/i.test(command)) return 2;
  return 1;
}

function inferRecipient(
  command: string,
  text: string | undefined,
  lookup: DingTalkRecipientLookup,
  options: Pick<DingTalkSentPreviewOptions, 'mentionHints' | 'assistantReplyText'> = {},
): { kind: DingTalkSentRecipientKind; label: string } {
  const mentionHints = options.mentionHints ?? [];
  const assistantReplyText = options.assistantReplyText;

  const group = readFlag(command, 'group');
  if (group) {
    const fromLookup = lookup.byGroupId.get(group);
    if (fromLookup) return { kind: 'group', label: fromLookup };
    const fromReply = extractRecipientNameFromAssistantReply(assistantReplyText, 'group');
    if (fromReply) return { kind: 'group', label: fromReply };
    return { kind: 'group', label: enrichRecipientLabel('群聊', mentionHints) };
  }

  const user = readFlag(command, 'user');
  if (user) {
    const fromLookup = lookup.byUserId.get(user);
    if (fromLookup) return { kind: 'user', label: fromLookup };
    const atMatch = text?.match(/@([^\s@]+)/);
    if (atMatch?.[1]) return { kind: 'user', label: atMatch[1] };
    const fromReply = extractRecipientNameFromAssistantReply(assistantReplyText, 'user');
    if (fromReply) return { kind: 'user', label: fromReply };
    return { kind: 'user', label: enrichRecipientLabel('联系人', mentionHints) };
  }

  if (readFlag(command, 'open-dingtalk-id')) {
    return { kind: 'user', label: enrichRecipientLabel('联系人', mentionHints) };
  }
  return { kind: 'unknown', label: '钉钉' };
}

function sanitizeRecipientLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  if (/^cid[A-Za-z0-9+/=_=-]{8,}$/i.test(trimmed)) return '群聊';
  if (/^\d{12,}$/.test(trimmed)) return '联系人';
  return trimmed;
}

function enrichRecipientLabel(label: string, mentionHints: string[] = []): string {
  const sanitized = sanitizeRecipientLabel(label);
  if (!GENERIC_RECIPIENT_LABELS.has(sanitized)) return sanitized;
  const hints = mentionHints.map((name) => name.trim()).filter(Boolean);
  if (hints.length === 1) return hints[0];
  if (hints.length > 1) return hints.join('、');
  return sanitized;
}

/** Parse `dws chat message send` from a shell / bash tool command string. */
export function parseDwsChatMessageSendCommand(
  command: string,
  options: Pick<DingTalkSentPreviewOptions, 'mentionHints' | 'userMessageRaw' | 'assistantReplyText'> = {},
): Omit<DingTalkSentMessagePreview, 'toolCallId'> | null {
  if (!DWS_SEND_CMD.test(command)) return null;
  const text = parseTextFlag(command);
  if (!text?.trim()) return null;
  const lookup = extractDingTalkRecipientLookup(options.userMessageRaw);
  const recipient = inferRecipient(command, text, lookup, options);
  return {
    recipientKind: recipient.kind,
    recipientLabel: recipient.label,
    title: readFlag(command, 'title'),
    text: text.trim(),
  };
}

export interface DingTalkSentPreviewParts {
  body: string;
  disclaimer?: string;
}

/** Split sent `--text` into body and optional agent-send disclaimer for UI cards. */
export function splitDingTalkSentPreviewText(text: string): DingTalkSentPreviewParts {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return { body: '' };

  const body = stripDingTalkAgentSendDisclaimerBody(normalized).trim();
  const hasDisclaimer = normalized.includes(DINGTALK_AGENT_SEND_DISCLAIMER_MARKER)
    || body.length < normalized.length;

  if (!hasDisclaimer) {
    return { body: normalized };
  }

  return {
    body,
    disclaimer: DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT,
  };
}

/** Sent-success card preview: body only (disclaimer rendered separately in UI). */
export function formatDingTalkSentTextForChatPreview(text: string): string {
  return splitDingTalkSentPreviewText(text).body;
}

/** Remove assistant reply bodies that duplicate DingTalk sent-success preview cards. */
export function stripEchoedDingTalkSentBodiesFromAssistantReply(
  replyText: string,
  previews: DingTalkSentMessagePreview[],
): string {
  if (!replyText?.trim() || previews.length === 0) return replyText;

  let result = replyText;
  for (const preview of previews) {
    const body = stripDingTalkAgentSendDisclaimerBody(preview.text).trim();
    if (!body) continue;

    if (result.includes(body)) {
      result = result.split(body).join('').trim();
    }

    const formatted = formatDingTalkSentTextForChatPreview(preview.text).trim();
    if (formatted && result.includes(formatted)) {
      result = result.split(formatted).join('').trim();
    }
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function extractToolResultText(message: DingTalkSentDisplayMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .join('\n')
    .trim();
}

function isSuccessfulDwsToolResult(message: DingTalkSentDisplayMessage): boolean {
  if (message.isError) return false;
  const text = extractToolResultText(message);
  if (!text) return true;
  if (/"ok"\s*:\s*false/i.test(text)) return false;
  if (/\bok\s*[:=]\s*false/i.test(text)) return false;
  if (/error|failed|失败|错误/i.test(text) && !/"ok"\s*:\s*true/i.test(text)) {
    return false;
  }
  return /"ok"\s*:\s*true/i.test(text)
    || /\bsuccess(?:ful)?\b/i.test(text)
    || /发送成功|已发送/i.test(text)
    || /openTaskId|processQueryKey/i.test(text);
}

function extractToolUseFromMessage(message: DingTalkSentDisplayMessage): Array<{ id: string; input: unknown }> {
  const tools: Array<{ id: string; input: unknown }> = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      const type = record.type;
      if (type !== 'tool_use' && type !== 'toolCall') continue;
      const name = record.name;
      if (typeof name !== 'string' || !name) continue;
      tools.push({
        id: typeof record.id === 'string' ? record.id : '',
        input: record.input ?? record.arguments,
      });
    }
  }
  const msg = message as Record<string, unknown>;
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      const name = typeof fn.name === 'string' ? fn.name : '';
      if (!name) continue;
      let input: unknown = fn.arguments ?? fn.input;
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          // keep raw string
        }
      }
      tools.push({
        id: typeof tc.id === 'string' ? tc.id : '',
        input,
      });
    }
  }
  return tools;
}

/**
 * Extract successfully sent DingTalk messages from an assistant turn
 * (assistant snapshots + interleaved tool results).
 */
export function extractDingTalkSentPreviews(
  turnMessages: DingTalkSentDisplayMessage[],
  toolResults: DingTalkSentDisplayMessage[] = [],
  options: DingTalkSentPreviewOptions = {},
): DingTalkSentMessagePreview[] {
  const parseOptions: Pick<DingTalkSentPreviewOptions, 'mentionHints' | 'userMessageRaw' | 'assistantReplyText'> = {
    mentionHints: options.mentionHints,
    userMessageRaw: options.userMessageRaw,
    assistantReplyText: options.assistantReplyText,
  };
  const resultOkByToolId = new Map<string, boolean>();
  for (const result of toolResults) {
    const toolCallId = result.toolCallId;
    if (!toolCallId) continue;
    resultOkByToolId.set(toolCallId, isSuccessfulDwsToolResult(result));
  }

  const previewsByKey = new Map<string, { preview: DingTalkSentMessagePreview; richness: number }>();

  for (const message of turnMessages) {
    for (const tool of extractToolUseFromMessage(message)) {
      const command = readToolInputCommand(tool.input);
      if (!command) continue;
      const parsed = parseDwsChatMessageSendCommand(command, parseOptions);
      if (!parsed) continue;

      if (tool.id) {
        const ok = resultOkByToolId.get(tool.id);
        if (ok === false) continue;
        if (toolResults.length > 0 && ok !== true) continue;
      }

      const key = previewDedupeKey(parsed);
      const richness = dwsSendRichness(command);
      const candidate: DingTalkSentMessagePreview = {
        toolCallId: tool.id || undefined,
        ...parsed,
      };
      const existing = previewsByKey.get(key);
      if (!existing || richness > existing.richness) {
        previewsByKey.set(key, { preview: candidate, richness });
      }
    }
  }

  return Array.from(previewsByKey.values()).map((entry) => entry.preview);
}
