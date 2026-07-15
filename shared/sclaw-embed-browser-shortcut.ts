/** Keyboard shortcut to toggle embed-browser AI chat (⌘L / Ctrl+L). */

export type SclawBrowserShortcutInput = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  control?: boolean;
  meta?: boolean;
  altKey?: boolean;
  alt?: boolean;
  key?: string;
  type?: string;
};

export function isSclawBrowserEmbedChatShortcut(
  input: SclawBrowserShortcutInput,
  platform: string,
): boolean {
  if (input.type && input.type !== 'keyDown') return false;
  const isMac = platform === 'darwin';
  const mod = isMac
    ? Boolean(input.metaKey ?? input.meta)
    : Boolean(input.ctrlKey ?? input.control);
  if (!mod) return false;
  if (input.altKey ?? input.alt) return false;
  return (input.key ?? '').toLowerCase() === 'l';
}

export function sclawBrowserEmbedChatShortcutLabel(platform: string): string {
  return platform === 'darwin' ? '⌘L' : 'Ctrl+L';
}
