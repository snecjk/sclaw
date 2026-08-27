import type { FlowCardAction, FlowCardContentBlock } from '../../shared/flow-card-protocol';

const QUOTE_UPLOAD_MULTI_HINT_RE = /[；;]?\s*支持一次多选[。.]?/g;
const QUOTE_UPLOAD_MULTI_LABEL_RE = /[（(]支持多选文件[）)]/g;

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

function normalizeQuoteUploadPickerAction(action: FlowCardAction): FlowCardAction {
  if (action.kind !== 'composer.openFilePicker') return action;
  const label = action.label
    .replace(QUOTE_UPLOAD_MULTI_LABEL_RE, '')
    .trim();
  return {
    ...action,
    label: label || '上传报价表',
    params: {
      ...action.params,
      multiple: false,
    },
  };
}

/**
 * Quote 卡片的客户端规范化：剥掉模型仍可能输出的「多选」文案，并强制单文件上传。
 * SKILL 更新后旧会话/旧模型输出仍走此路径。
 */
export function normalizeQuoteFlowCard(card: FlowCardContentBlock): FlowCardContentBlock {
  if (card.domain !== 'quote') return card;

  const hint = card.hint
    ? card.hint.replace(QUOTE_UPLOAD_MULTI_HINT_RE, '').trim()
    : card.hint;
  const actions = card.actions?.map((action) => normalizeQuoteUploadPickerAction(action));

  return {
    ...card,
    hint,
    actions,
  };
}
