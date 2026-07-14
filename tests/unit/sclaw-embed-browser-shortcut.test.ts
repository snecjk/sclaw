import { describe, expect, it } from 'vitest';
import {
  isSclawBrowserEmbedChatShortcut,
  sclawBrowserEmbedChatShortcutLabel,
} from '../../shared/sclaw-embed-browser-shortcut';

describe('sclaw-embed-browser-shortcut', () => {
  it('matches macOS command+L', () => {
    expect(isSclawBrowserEmbedChatShortcut({
      type: 'keyDown',
      metaKey: true,
      key: 'l',
    }, 'darwin')).toBe(true);
  });

  it('matches Windows ctrl+L', () => {
    expect(isSclawBrowserEmbedChatShortcut({
      type: 'keyDown',
      ctrlKey: true,
      key: 'L',
    }, 'win32')).toBe(true);
  });

  it('ignores plain L and alt modifiers', () => {
    expect(isSclawBrowserEmbedChatShortcut({ key: 'l' }, 'darwin')).toBe(false);
    expect(isSclawBrowserEmbedChatShortcut({
      metaKey: true,
      altKey: true,
      key: 'l',
    }, 'darwin')).toBe(false);
  });

  it('formats shortcut labels', () => {
    expect(sclawBrowserEmbedChatShortcutLabel('darwin')).toBe('⌘L');
    expect(sclawBrowserEmbedChatShortcutLabel('win32')).toBe('Ctrl+L');
  });
});
