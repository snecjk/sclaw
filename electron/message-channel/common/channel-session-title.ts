const CHANNEL_SESSION_TITLE_MAX_LEN = 50;
const PLACEHOLDER_CHANNEL_TITLES = new Set(['新对话', 'New Chat', '新しいチャット']);

/** Derive list title from first inbound prompt; empty → no write. */
export function deriveChannelSessionTitle(prompt: string, maxLen = CHANNEL_SESSION_TITLE_MAX_LEN): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

export function isBlankOrPlaceholderChannelTitle(title: string | null | undefined): boolean {
  const current = title?.trim() || '';
  return !current || PLACEHOLDER_CHANNEL_TITLES.has(current);
}
