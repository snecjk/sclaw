export function logInfo(message: string, extra?: Record<string, unknown>): void {
  if (extra) {
    console.log(`[app-backend] ${message}`, extra);
    return;
  }
  console.log(`[app-backend] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  console.error(`[app-backend] ${message}`, err instanceof Error ? err.message : err ?? '');
}
