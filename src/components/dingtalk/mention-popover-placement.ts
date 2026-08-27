/** @ 联系人浮层尺寸与视口边距（与 DingTalkMentionPopover 视觉一致） */
export const MENTION_POPOVER_WIDTH = 320;
export const MENTION_POPOVER_MAX_HEIGHT = 280;
export const MENTION_POPOVER_MIN_PANEL_HEIGHT = 160;
export const MENTION_POPOVER_MIN_UPWARD_HEIGHT = 240;
export const MENTION_POPOVER_VIEWPORT_PADDING = 12;
export const MENTION_POPOVER_GAP = 8;

export type MentionPopoverPlacement = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: 'above' | 'below';
};

export type MentionPopoverCaretRect = Readonly<{
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}>;

export type MentionPopoverPlacementInput = {
  caretRect: MentionPopoverCaretRect;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth?: number;
  panelMaxHeight?: number;
  viewportPadding?: number;
  gap?: number;
  minUpwardHeight?: number;
};

function clampPanelHeight(
  available: number,
  panelMaxHeight: number,
): number {
  return Math.min(panelMaxHeight, Math.max(0, available));
}

/**
 * 根据光标（或回退锚点）视口矩形计算 portal fixed 定位。
 * 垂直：优先向上；向上不足时翻转向下并限制 maxHeight。
 * 水平：默认左对齐光标；行尾右侧溢出时改为右对齐光标。
 */
export function computeMentionPopoverPlacement({
  caretRect,
  viewportWidth,
  viewportHeight,
  panelWidth = MENTION_POPOVER_WIDTH,
  panelMaxHeight = MENTION_POPOVER_MAX_HEIGHT,
  viewportPadding = MENTION_POPOVER_VIEWPORT_PADDING,
  gap = MENTION_POPOVER_GAP,
  minUpwardHeight = MENTION_POPOVER_MIN_UPWARD_HEIGHT,
}: MentionPopoverPlacementInput): MentionPopoverPlacement {
  const width = Math.min(panelWidth, viewportWidth - viewportPadding * 2);

  let left = caretRect.left;
  if (left + width > viewportWidth - viewportPadding) {
    left = caretRect.right - width;
  }
  left = Math.min(
    Math.max(viewportPadding, left),
    viewportWidth - width - viewportPadding,
  );

  const upwardSpace = Math.max(0, caretRect.top - viewportPadding);
  const downwardSpace = Math.max(0, viewportHeight - caretRect.bottom - viewportPadding);
  const availableAbove = Math.max(0, upwardSpace - gap);
  const availableBelow = Math.max(0, downwardSpace - gap);

  const flipDown = upwardSpace < minUpwardHeight && downwardSpace >= upwardSpace;
  const placeBelow = flipDown || (availableBelow > availableAbove && upwardSpace < minUpwardHeight);

  if (placeBelow) {
    return {
      left,
      top: caretRect.bottom + gap,
      maxHeight: clampPanelHeight(availableBelow, panelMaxHeight),
      placement: 'below',
    };
  }

  return {
    left,
    bottom: viewportHeight - caretRect.top + gap,
    maxHeight: clampPanelHeight(availableAbove, panelMaxHeight),
    placement: 'above',
  };
}
