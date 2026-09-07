export interface ContextUsageDialogRect {
  left: number;
  right: number;
  top: number;
  width: number;
}

export interface ContextUsageDialogLayout {
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
}

const DIALOG_MAX_WIDTH = 340;
const EDGE_GAP = 12;
const ANCHOR_GAP = 8;

/** Keep the App Plaza compaction dialog inside its narrow chat column. */
export function resolveEmbedContextUsageDialogLayout(input: {
  anchor: ContextUsageDialogRect;
  panel: ContextUsageDialogRect;
  viewportWidth: number;
  viewportHeight: number;
}): ContextUsageDialogLayout {
  const panelLeft = Math.max(0, input.panel.left);
  const panelRight = Math.min(input.viewportWidth, input.panel.right);
  const availableWidth = Math.max(0, panelRight - panelLeft - EDGE_GAP * 2);
  const width = Math.min(DIALOG_MAX_WIDTH, availableWidth);
  const minLeft = panelLeft + EDGE_GAP;
  const maxLeft = Math.max(minLeft, panelRight - EDGE_GAP - width);
  const left = Math.min(Math.max(input.anchor.left, minLeft), maxLeft);

  return {
    left,
    bottom: Math.max(EDGE_GAP, input.viewportHeight - input.anchor.top + ANCHOR_GAP),
    width,
    maxHeight: Math.max(0, input.anchor.top - EDGE_GAP * 2),
  };
}
