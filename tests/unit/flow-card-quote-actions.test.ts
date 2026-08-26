import { describe, expect, it } from 'vitest';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';
import {
  filterQuoteFlowCardActions,
  isQuoteSubmitAction,
  shouldHideQuoteSubmitActions,
} from '@/lib/flow-card-quote-actions';

const submitAction = {
  id: 'submit',
  label: '提交报价',
  variant: 'primary' as const,
  kind: 'chat.sendMessage' as const,
  params: { text: '提交报价', skillSlugs: ['quote-assistant'] },
};

const openDetailAction = {
  id: 'open_detail',
  label: '打开详情',
  variant: 'secondary' as const,
  kind: 'nav.openPreviewTab' as const,
  params: { urlKey: 'detailUrl' },
};

describe('flow-card-quote-actions', () => {
  it('detects quote submit actions', () => {
    expect(isQuoteSubmitAction(submitAction)).toBe(true);
    expect(isQuoteSubmitAction(openDetailAction)).toBe(false);
  });

  it('hides submit after submitted phase', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'submitted',
      actions: [openDetailAction, submitAction],
    });
    expect(shouldHideQuoteSubmitActions(card)).toBe(true);
    expect(filterQuoteFlowCardActions(card, card.actions ?? [])).toEqual([openDetailAction]);
  });

  it('hides submit on legacy editing card with previewMode refresh', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'editing',
      title: '解析完成',
      data: { previewMode: 'refresh', quoteId: 'Q-1', ossKey: 'vip/osstmp/x' },
      actions: [openDetailAction, submitAction],
    });
    expect(shouldHideQuoteSubmitActions(card)).toBe(true);
    expect(filterQuoteFlowCardActions(card, card.actions ?? [])).toEqual([openDetailAction]);
  });

  it('keeps submit on ready_to_save card', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'ready_to_save',
      data: { validationOutcome: 'pass', ossKey: 'vip/osstmp/x' },
      actions: [submitAction],
    });
    expect(shouldHideQuoteSubmitActions(card)).toBe(false);
    expect(filterQuoteFlowCardActions(card, card.actions ?? [])).toEqual([submitAction]);
  });

  it('hides submit on editing card with quoteId even without previewMode', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'editing',
      title: '解析完成',
      data: { quoteId: 'Q-1', ossKey: 'vip/osstmp/x' },
      actions: [openDetailAction, submitAction],
    });
    expect(filterQuoteFlowCardActions(card, card.actions ?? [])).toEqual([openDetailAction]);
  });
});
