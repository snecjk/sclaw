import type { FlowCardAction, FlowCardContentBlock } from '../../shared/flow-card-protocol';

function readTrimmedString(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Quote flow: chat.sendMessage that triggers vip quotation save / submit. */
export function isQuoteSubmitAction(action: FlowCardAction): boolean {
  if (action.kind !== 'chat.sendMessage') return false;
  const text = typeof action.params?.text === 'string' ? action.params.text.trim() : '';
  const label = action.label.trim();
  const haystack = `${text} ${label}`;
  return haystack.includes('提交报价') || haystack.includes('保存报价');
}

/**
 * After `vip quotation save`, the card must not offer submit again.
 * Models may still emit legacy `editing` + 「解析完成」 cards — hide submit client-side.
 */
export function shouldHideQuoteSubmitActions(card: FlowCardContentBlock): boolean {
  if (card.domain !== 'quote') return false;
  if (card.phase === 'submitted') return true;
  if (card.phase === 'ready_to_save') return false;
  if (readTrimmedString(card.data, 'previewMode') === 'refresh') return true;
  if (card.phase === 'editing' && readTrimmedString(card.data, 'quoteId')) return true;
  return false;
}

export function filterQuoteFlowCardActions(
  card: FlowCardContentBlock,
  actions: FlowCardAction[],
): FlowCardAction[] {
  if (!shouldHideQuoteSubmitActions(card)) return actions;
  return actions.filter((action) => !isQuoteSubmitAction(action));
}
