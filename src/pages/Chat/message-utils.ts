/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import { useMemo } from 'react';
import type { RawMessage, ContentBlock } from '@/stores/chat';

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  return text
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

  // Strip Gateway metadata from user messages for clean display
  if (isUser && result) {
    result = cleanUserText(result);
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
      const cleaned = block.thinking.trim();
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
        const cleaned = block.thinking.trim();
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
 */
const PREVIEWABLE_MIME_PREFIXES = [
  'text/html',
];

export function isPreviewableFile(file: { mimeType: string; filePath?: string }): boolean {
  if (!file.filePath) return false;
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? file.mimeType.startsWith(prefix) : file.mimeType === prefix,
  );
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html',
    pdf: 'application/pdf',
    md: 'text/markdown', txt: 'text/plain',
    json: 'application/json', csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract previewable local file paths and localhost URLs from plain text.
 * Matches absolute paths like /Users/.../file.html and localhost URLs like http://localhost:8080/path.
 */
export function extractPreviewableRefs(text: string): Array<{ filePath: string; fileName: string; mimeType: string }> {
  const results: Array<{ filePath: string; fileName: string; mimeType: string }> = [];
  const seen = new Set<string>();

  function addIfNotImage(filePath: string, fileName: string, ext: string) {
    const mimeType = extToMimeType(ext);
    if (mimeType.startsWith('image/')) return;
    if (seen.has(filePath)) return;
    seen.add(filePath);
    results.push({ filePath, fileName, mimeType });
  }

  // Web URLs (localhost and external)
  const urlRegex = /(https?:\/\/[^\s)\]"',;<>]+)/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[1];
    const fileName = url.split('/').pop() || 'index.html';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    addIfNotImage(url, fileName, ext);
  }

  // Absolute file paths (Unix / Windows) — only HTML files (tied to PPT/report generation preview)
  const pathRegex = /(\/(?:[\w.-]+\/)*[\w.-]+\.html?|[A-Za-z]:[\\\/](?:[\w.-]+[\\\/])*[\w.-]+\.html?)/g;
  while ((match = pathRegex.exec(text)) !== null) {
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
export function usePreviewableFiles(messages: Array<unknown & { _attachedFiles?: Array<{ mimeType: string; filePath?: string; fileName: string }>; content?: unknown }>) {
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
      if (msg._attachedFiles) {
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

      // Path 2: references in message text
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
