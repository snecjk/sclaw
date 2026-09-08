import type { WebContents } from 'electron';

/** Cross-origin frame key events do not bubble to the shell. The renderer decides
 * whether a preview overlay is open; ordinary/expanded previews are unaffected.
 */
export function forwardPreviewFrameEscape(contents: WebContents): void {
  contents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !input.isAutoRepeat
      && contents.focusedFrame && contents.focusedFrame !== contents.mainFrame) {
      contents.send('preview:frame-escape');
    }
  });
}
