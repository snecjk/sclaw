/** Config-driven quick actions above the chat composer (App Plaza embed + main session). */

export interface EmbedComposerAction {
  id: string;
  label: string;
  sendText: string;
  skillSlugs?: string[];
  disabled?: boolean;
  tip?: string;
  /** Optional permission code — hidden when not granted (future). */
  permission?: string;
}

export function resolveEmbedComposerActions(
  configured?: EmbedComposerAction[] | null,
): EmbedComposerAction[] {
  if (!configured?.length) return [];
  return [...configured];
}
