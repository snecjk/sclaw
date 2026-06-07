/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import { useMemo } from 'react';
import type { RawMessage, ContentBlock } from '@/stores/chat';
import { stripDingTalkMentionContextForDisplay } from '@/lib/dingtalk-mention-context';

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  const cleaned = text
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
    .trim();
  return stripDingTalkMentionContextForDisplay(cleaned);
}

/** Strip dws send metadata that agents should not surface to end users. */
const DWS_SEND_METADATA_PATTERN =
  /[,，]?\s*(?:\*\*)?(?:任务\s*ID|openTaskId|processQueryKey)(?:\*\*)?\s*[：:]\s*[A-Za-z0-9+/=_-]+(?:\*\*)?/gi;

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

function cleanAssistantText(text: string): string {
  return stripDwsSendMetadataForDisplay(text);
}

function cleanThinkingText(text: string): string {
  return stripDwsSendMetadataForDisplay(text);
}

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 * For user messages, strips Gateway-injected metadata.
 */
export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const isUser = msg.role === 'user';

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

  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';

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

export function isPreviewableFile(file: { mimeType: string; filePath?: string }): boolean {
  if (!file.filePath) return false;
  const filePath = file.filePath;
  // Web URLs (http/https) are excluded from built-in preview because they may have
  // anti-hotlink / X-Frame-Options / CSP blocking, and should open in external browser.
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return false;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
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

/** Shared extension list for previewable local file paths (used by extractPreviewableRefs and preprocessTextForPreviewLinks). */
export const PREVIEWABLE_FILE_EXTS =
  'properties|swift|scala|bash|fish|html?|java|jsx|tsx|cpp|php|toml|conf|scss|less|zsh|yaml|json|sql|xml|csv|tsv|txt|log|ini|env|md|htm|py|go|rs|cs|rb|mm|bat|cmd|pdf|kt|css|yml|ts|js|sh|c|h|r|m';

/** Remove fenced code blocks from text so paths inside them are not matched.
 *  Inline code (`path`) is preserved — it often contains actual file paths the user/AI wants to preview.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
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

  function addIfNotImage(filePath: string, fileName: string, ext: string) {
    const mimeType = extToMimeType(ext);
    if (mimeType.startsWith('image/')) return;
    if (seen.has(filePath)) return;
    seen.add(filePath);
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

  // Localhost URLs only (previewable in side panel)
  const urlRegex = /(https?:\/\/localhost:[^\s)\]"',;<>]+)/g;
  while ((match = urlRegex.exec(cleanText)) !== null) {
    const url = match[1];
    const fileName = url.split('/').pop() || 'index.html';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(url, fileName, ext);
  }

  // File paths (relative ./, absolute /, and Windows C:\) — support code, config, doc, and web files
  // Lookbehind (?<![\\w./:]) rejects matches that are part of a URL path component
  const pathRegex = new RegExp(
    `(?<![\\w./:])(\\./(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|\\/(?:[^/\\n\\r]+\\/)*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS})|[A-Za-z]:[\\\\/](?:[^/\\n\\r]+[\\\\/])*[^/\\n\\r]+\\.(?:${PREVIEWABLE_FILE_EXTS}))`,
    'gi',
  );
  while ((match = pathRegex.exec(cleanText)) !== null) {
    const path = match[1].replace(/\\/g, '/');
    const fileName = path.split('/').pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(path, fileName, ext);
  }

  return results;
}

/**
 * Extract previewable files from an array of messages.
 * Includes both _attachedFiles and references found in message text.
 */
export function usePreviewableFiles(messages: Array<unknown & { _attachedFiles?: Array<{ mimeType: string; filePath?: string; fileName: string }>; content?: unknown; role?: string }>) {
  return useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null }> = [];

    function addItem(item: { mimeType: string; filePath: string; fileName: string; fileSize: number; preview: string | null }) {
      if (seen.has(item.filePath)) return;
      seen.add(item.filePath);
      result.push(item);
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
  }, [messages]);
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
