import {
  type PreviewExtractTraceContext,
  type PreviewExtractTraceEvent,
  type RawFilePathScanTraceInput,
  type RawFilePathScanTraceResult,
} from '../../shared/preview-extract-trace';

export type {
  PreviewExtractSource,
  PreviewExtractTraceContext,
  PreviewExtractTraceEvent,
} from '../../shared/preview-extract-trace';

/**
 * Formerly emitted `[PreviewExtract]` / `[StoClaw file-preview]` trace logs to
 * the Main log file. Logging has been removed; these are kept as no-ops so the
 * many call sites in chat stores / message-utils continue to compile unchanged.
 */

export function traceRawFilePathScanStart(
  _context: PreviewExtractTraceContext,
  _input: RawFilePathScanTraceInput,
): void {
  // no-op: preview-extract logging removed
}

export function traceRawFilePathScanDone(
  _context: PreviewExtractTraceContext,
  _result: RawFilePathScanTraceResult,
): void {
  // no-op: preview-extract logging removed
}

export function tracePreviewExtract(_event: PreviewExtractTraceEvent): void {
  // no-op: preview-extract logging removed
}
