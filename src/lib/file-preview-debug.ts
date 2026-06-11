/**
 * Dev-only diagnostics for chat file preview rendering.
 * Open DevTools → Console, filter by `[StoClaw file-preview]`.
 *
 * Disable: localStorage.setItem('stoclaw:debug-file-preview', '0')
 * Re-enable: localStorage.removeItem('stoclaw:debug-file-preview')
 */
export function isFilePreviewDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem('stoclaw:debug-file-preview') !== '0';
  } catch {
    return true;
  }
}

export function logFilePreview(stage: string, payload: Record<string, unknown>): void {
  if (!isFilePreviewDebugEnabled()) return;
  console.log(`[StoClaw file-preview] ${stage}`, payload);
}
