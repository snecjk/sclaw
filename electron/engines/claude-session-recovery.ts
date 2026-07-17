export function isMissingClaudeConversationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no conversation found with session id/i.test(message);
}

export function appendArchivedClaudeSessionId(
  archivedSessionIds: string[] | undefined,
  sessionId: string,
): string[] {
  const normalized = sessionId.trim();
  if (!normalized) return [...(archivedSessionIds ?? [])];
  return [...new Set([...(archivedSessionIds ?? []), normalized])];
}
