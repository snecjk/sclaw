import { hostApiFetch } from '@/lib/host-api';

/**
 * Diagnostics for chat file preview extraction/rendering.
 *
 * Dev: on by default. Prod: off unless `localStorage.setItem('stoclaw:debug-file-preview', '1')`.
 * Disable: `localStorage.setItem('stoclaw:debug-file-preview', '0')`
 *
 * Logs go to DevTools console and Main log file (`~/Library/Application Support/StoClaw/logs/`).
 * Filter log file by `[PreviewExtract]` or `[StoClaw file-preview]`.
 * Raw-path scans also emit `raw-path-scan-start` / `raw-path-scan-done` with full input excerpt + refs list.
 */
export function isFilePreviewDebugEnabled(): boolean {
  try {
    const flag = localStorage.getItem('stoclaw:debug-file-preview');
    if (flag === '0') return false;
    if (flag === '1') return true;
    return !!import.meta.env.DEV;
  } catch {
    return !!import.meta.env.DEV;
  }
}

export function logFilePreview(stage: string, payload: Record<string, unknown>): void {
  if (!isFilePreviewDebugEnabled()) return;

  const message = `[StoClaw file-preview] stage=${stage}`;
  const data = { stage, ...payload, timestamp: new Date().toISOString() };

  console.info(message, data);

  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({
      level: 'info',
      message,
      data,
    }),
  }).catch(() => undefined);
}
