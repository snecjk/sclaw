/** Always-visible OpenIM diagnostics (use warn so DevTools default filter shows it). */
export function openimLog(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.warn(`[OpenIM] ${message}`, detail);
    return;
  }
  console.warn(`[OpenIM] ${message}`);
}
