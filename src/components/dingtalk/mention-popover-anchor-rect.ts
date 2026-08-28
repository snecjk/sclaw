import {
  getMentionTriggerCaretRect,
  type ActiveMentionTrigger,
} from '@/lib/dingtalk-mention-composer';

export type MentionPopoverAnchorRect = Readonly<{
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

function isUsableRect(rect: DOMRect | null): rect is DOMRect {
  return Boolean(rect && (rect.width > 0 || rect.height > 0));
}

function toAnchorRect(rect: DOMRect): MentionPopoverAnchorRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 优先取 @ 光标处矩形；无效时回退到 host 元素矩形（兼容未传 trigger 的调用方）。
 */
export function resolveMentionPopoverAnchorRect(
  editorRoot: HTMLElement | null | undefined,
  trigger: ActiveMentionTrigger | null | undefined,
  fallbackHost: HTMLElement | null | undefined,
): MentionPopoverAnchorRect | null {
  if (editorRoot && trigger) {
    const caretRect = getMentionTriggerCaretRect(editorRoot, trigger);
    if (isUsableRect(caretRect)) {
      return toAnchorRect(caretRect);
    }
  }

  const hostRect = fallbackHost?.getBoundingClientRect();
  if (!hostRect) return null;
  return toAnchorRect(hostRect);
}
