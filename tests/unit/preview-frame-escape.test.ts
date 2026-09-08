// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { forwardPreviewFrameEscape } from '../../electron/main/preview-frame-escape';

describe('preview frame Escape bridge', () => {
  it('forwards only a fresh Escape keydown from a focused child frame', () => {
    const mainFrame = {};
    const contents = Object.assign(new EventEmitter(), { mainFrame, focusedFrame: mainFrame, send: vi.fn() });
    forwardPreviewFrameEscape(contents as unknown as WebContents);
    const press = (key: string, type = 'keyDown', isAutoRepeat = false) => contents.emit('before-input-event', {}, { key, type, isAutoRepeat });
    press('Escape');
    expect(contents.send).not.toHaveBeenCalled();
    contents.focusedFrame = {};
    press('Enter');
    press('Escape', 'keyUp');
    press('Escape', 'keyDown', true);
    expect(contents.send).not.toHaveBeenCalled();
    press('Escape');
    expect(contents.send).toHaveBeenCalledExactlyOnceWith('preview:frame-escape');
  });
});
