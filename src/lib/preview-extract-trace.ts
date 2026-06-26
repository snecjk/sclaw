import { hostApiFetch } from '@/lib/host-api';
import {
  formatPreviewExtractLogMessage,
  type PreviewExtractTraceEvent,
} from '../../shared/preview-extract-trace';
import { isFilePreviewDebugEnabled } from '@/lib/file-preview-debug';

export type {
  PreviewExtractSource,
  PreviewExtractTraceContext,
  PreviewExtractTraceEvent,
} from '../../shared/preview-extract-trace';

/** Emit a structured trace when a preview path is extracted from message/tool text. */
export function tracePreviewExtract(event: PreviewExtractTraceEvent): void {
  if (!isFilePreviewDebugEnabled()) return;

  const message = formatPreviewExtractLogMessage(event);
  const payload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  // DevTools: filter by `[PreviewExtract]` or `[StoClaw file-preview]`
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
