/**
 * Debug-flag helper for chat file preview rendering.
 *
 * Controls visibility of the render-debug panel in ChatMessage.
 * Verbose file-preview logging has been removed; this flag now only gates UI.
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

/**
 * Formerly emitted `[StoClaw file-preview]` diagnostics logs (console + Main log
 * file). Logging has been removed; kept as a no-op to avoid touching call sites.
 */
export function logFilePreview(_stage: string, _payload: Record<string, unknown>): void {
  // no-op: file-preview logging removed
}
