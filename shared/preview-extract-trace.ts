/**
 * Shared types for file-preview path extraction diagnostics.
 * Used by renderer extractors and Main-process gateway enrich.
 */

export type PreviewExtractSource =
  | 'tool-result:media-attached'
  | 'tool-result:raw-path'
  | 'tool-result:image-block'
  | 'history:media-attached'
  | 'history:raw-path'
  | 'assistant-text:previewable-refs'
  | 'gateway-enrich:media-attached'
  | 'runtime:tool-final';

export interface PreviewExtractTraceContext {
  source: PreviewExtractSource;
  messageId?: string;
  toolCallId?: string;
  sessionKey?: string;
  /** Diagnostics: which message body is being scanned. */
  scanTarget?: 'assistant-self' | 'preceding-user' | 'tool-result';
}

export interface PreviewExtractTraceEvent {
  source: PreviewExtractSource;
  /** Which matcher / rule fired, e.g. `media-attached-regex` or `path-line`. */
  reason: string;
  extracted: {
    filePath: string;
    fileName?: string;
    mimeType?: string;
  };
  /** Original matched snippet from message / tool output. */
  excerpt: string;
  context?: Record<string, unknown>;
}

const MAX_EXCERPT_LEN = 320;
const MAX_SCAN_INPUT_LEN = 800;

export function truncatePreviewExtractExcerpt(text: string, maxLen = MAX_EXCERPT_LEN): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

export function formatPreviewExtractLogMessage(event: PreviewExtractTraceEvent): string {
  const name = event.extracted.fileName
    ?? event.extracted.filePath.split(/[\\/]/).pop()
    ?? event.extracted.filePath;
  return `[PreviewExtract] source=${event.source} reason=${event.reason} path=${event.extracted.filePath} name=${name}`;
}

export interface RawFilePathScanRef {
  filePath: string;
  mimeType: string;
  fileName?: string;
}

export interface RawFilePathScanTraceInput {
  rawText: string;
  cleanText: string;
}

export interface RawFilePathScanTraceResult {
  rawTextLength: number;
  cleanTextLength: number;
  refs: RawFilePathScanRef[];
}

export function truncatePreviewScanInput(text: string, maxLen = MAX_SCAN_INPUT_LEN): string {
  return truncatePreviewExtractExcerpt(text, maxLen);
}
