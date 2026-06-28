import { hostApiFetch } from '@/lib/host-api';
import {
  formatPreviewExtractLogMessage,
  truncatePreviewScanInput,
  type PreviewExtractTraceContext,
  type PreviewExtractTraceEvent,
  type RawFilePathScanTraceInput,
  type RawFilePathScanTraceResult,
} from '../../shared/preview-extract-trace';
import { isFilePreviewDebugEnabled } from '@/lib/file-preview-debug';

export type {
  PreviewExtractSource,
  PreviewExtractTraceContext,
  PreviewExtractTraceEvent,
} from '../../shared/preview-extract-trace';

/** Dedupe identical extract traces within a session (React re-renders / Strict Mode). */
const _previewExtractTraceKeys = new Set<string>();
const _rawFilePathScanKeys = new Set<string>();

function previewExtractTraceKey(event: PreviewExtractTraceEvent): string {
  return `${event.source}\0${event.reason}\0${event.extracted.filePath}\0${event.excerpt}`;
}

export function resetPreviewExtractTraceDedupe(): void {
  _previewExtractTraceKeys.clear();
  _rawFilePathScanKeys.clear();
}

function rawFilePathScanDedupeKey(
  phase: 'start' | 'done',
  context: PreviewExtractTraceContext,
  textFingerprint: string,
  refsFingerprint = '',
): string {
  return `${phase}\0${context.source}\0${context.messageId ?? ''}\0${context.toolCallId ?? ''}\0${textFingerprint}\0${refsFingerprint}`;
}

function emitRawFilePathScanLog(message: string, data: Record<string, unknown>): void {
  console.info('[StoClaw file-preview]', message, data);
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data,
    }),
  }).catch(() => undefined);
}

/** Log raw-path scan input (full excerpt + post–code-block strip text). */
export function traceRawFilePathScanStart(
  context: PreviewExtractTraceContext,
  input: RawFilePathScanTraceInput,
): void {
  if (!isFilePreviewDebugEnabled()) return;

  const rawExcerpt = truncatePreviewScanInput(input.rawText);
  const dedupeKey = rawFilePathScanDedupeKey('start', context, rawExcerpt);
  if (_rawFilePathScanKeys.has(dedupeKey)) return;
  _rawFilePathScanKeys.add(dedupeKey);

  const message = `[PreviewExtract] raw-path-scan-start source=${context.source} messageId=${context.messageId ?? '-'}`;
  const payload = {
    phase: 'start',
    source: context.source,
    messageId: context.messageId,
    toolCallId: context.toolCallId,
    sessionKey: context.sessionKey,
    scanTarget: context.scanTarget,
    rawTextLength: input.rawText.length,
    cleanTextLength: input.cleanText.length,
    strippedByCodeBlocks: input.rawText.length - input.cleanText.length,
    rawTextExcerpt: rawExcerpt,
    cleanTextExcerpt: truncatePreviewScanInput(input.cleanText),
    timestamp: new Date().toISOString(),
  };
  emitRawFilePathScanLog(message, payload);
}

/** Log raw-path scan output (all refs after matching). */
export function traceRawFilePathScanDone(
  context: PreviewExtractTraceContext,
  result: RawFilePathScanTraceResult,
): void {
  if (!isFilePreviewDebugEnabled()) return;

  const refsFingerprint = result.refs.map((r) => `${r.filePath}\0${r.mimeType}`).join('|');
  const dedupeKey = rawFilePathScanDedupeKey(
    'done',
    context,
    String(result.rawTextLength),
    refsFingerprint,
  );
  if (_rawFilePathScanKeys.has(dedupeKey)) return;
  _rawFilePathScanKeys.add(dedupeKey);

  const message = `[PreviewExtract] raw-path-scan-done source=${context.source} messageId=${context.messageId ?? '-'} refs=${result.refs.length}`;
  const payload = {
    phase: 'done',
    source: context.source,
    messageId: context.messageId,
    toolCallId: context.toolCallId,
    sessionKey: context.sessionKey,
    scanTarget: context.scanTarget,
    rawTextLength: result.rawTextLength,
    cleanTextLength: result.cleanTextLength,
    refsCount: result.refs.length,
    refs: result.refs.map((ref) => ({
      filePath: ref.filePath,
      mimeType: ref.mimeType,
      fileName: ref.fileName ?? ref.filePath.split(/[\\/]/).pop(),
    })),
    timestamp: new Date().toISOString(),
  };
  emitRawFilePathScanLog(message, payload);
}

/** Emit a structured trace when a preview path is extracted from message/tool text. */
export function tracePreviewExtract(event: PreviewExtractTraceEvent): void {
  if (!isFilePreviewDebugEnabled()) return;

  const dedupeKey = previewExtractTraceKey(event);
  if (_previewExtractTraceKeys.has(dedupeKey)) return;
  _previewExtractTraceKeys.add(dedupeKey);

  const message = formatPreviewExtractLogMessage(event);
  const payload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  console.info('[StoClaw file-preview]', message, payload);

  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data: payload,
    }),
  }).catch(() => undefined);
}
