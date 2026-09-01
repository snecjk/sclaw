import type { FlowCardAction, FlowCardContentBlock } from '../../shared/flow-card-protocol';

const QUOTE_UPLOAD_MULTI_HINT_RE = /[；;]?\s*支持一次多选[。.]?/g;
const QUOTE_UPLOAD_MULTI_LABEL_RE = /[（(]支持多选文件[）)]/g;
const QUOTE_SUBMIT_NL_HINT = '请在下方对话框输入「提交报价」完成保存。如需更换文件，请发送「重新上传报价表」。';

function readTrimmedString(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function actionHaystack(action: FlowCardAction): string {
  const text = typeof action.params?.text === 'string' ? action.params.text.trim() : '';
  return `${text} ${action.label}`.trim();
}

/** Quote flow: chat.sendMessage that triggers vip quotation save / submit. */
export function isQuoteSubmitAction(action: FlowCardAction): boolean {
  if (action.kind !== 'chat.sendMessage') return false;
  const haystack = actionHaystack(action);
  return haystack.includes('提交报价') || haystack.includes('保存报价');
}

/** Re-upload picker / send-message after a file is already on the card. */
export function isQuoteReuploadAction(action: FlowCardAction): boolean {
  const haystack = actionHaystack(action);
  if (!haystack.includes('重新上传') && !haystack.includes('更换文件')) return false;
  return action.kind === 'composer.openFilePicker' || action.kind === 'chat.sendMessage';
}

/**
 * Submit / re-upload are conversational (type in composer), not card buttons.
 * Keep the first-upload picker on `awaiting_upload`.
 */
export function shouldHideQuoteSubmitActions(card: FlowCardContentBlock): boolean {
  return card.domain === 'quote';
}

export function filterQuoteFlowCardActions(
  card: FlowCardContentBlock,
  actions: FlowCardAction[],
): FlowCardAction[] {
  if (card.domain !== 'quote') return actions;
  return actions.filter((action) => {
    if (isQuoteSubmitAction(action) || isQuoteReuploadAction(action)) return false;
    if (action.kind === 'composer.openFilePicker' && card.phase !== 'awaiting_upload') {
      return false;
    }
    return true;
  });
}

function shouldPromptQuoteSubmitInChat(card: FlowCardContentBlock): boolean {
  if (card.domain !== 'quote') return false;
  if (card.phase === 'submitted' || card.phase === 'errors' || card.phase === 'awaiting_upload') {
    return false;
  }
  if (card.phase === 'ready_to_save') return true;
  return readTrimmedString(card.data, 'validationOutcome') === 'pass';
}

function withQuoteSubmitNaturalLanguageHint(card: FlowCardContentBlock): FlowCardContentBlock {
  if (!shouldPromptQuoteSubmitInChat(card)) return card;
  const existing = `${card.body ?? ''} ${card.hint ?? ''}`;
  if (existing.includes('提交报价')) return card;
  const hasProgress = Array.isArray(card.data?.progressSteps) && card.data.progressSteps.length > 0;
  if (card.body?.trim() || hasProgress) {
    const body = card.body?.trim()
      ? `${card.body.trim()}\n${QUOTE_SUBMIT_NL_HINT}`
      : QUOTE_SUBMIT_NL_HINT;
    return { ...card, body };
  }
  const hint = card.hint?.trim()
    ? `${card.hint.trim()} ${QUOTE_SUBMIT_NL_HINT}`
    : QUOTE_SUBMIT_NL_HINT;
  return { ...card, hint };
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
  const actions = filterQuoteFlowCardActions(
    card,
    (card.actions ?? []).map((action) => normalizeQuoteUploadPickerAction(action)),
  );

  return withQuoteSubmitNaturalLanguageHint({
    ...card,
    hint,
    actions: actions.length > 0 ? actions : undefined,
  });
}
