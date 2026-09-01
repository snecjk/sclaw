import { describe, expect, it } from 'vitest';
import { createFlowCardBlock } from '../../shared/flow-card-protocol';
import {
  filterQuoteFlowCardActions,
  isQuoteReuploadAction,
  isQuoteSubmitAction,
  normalizeQuoteFlowCard,
  shouldHideQuoteSubmitActions,
} from '@/lib/flow-card-quote-actions';

const submitAction = {
  id: 'submit',
  label: '提交报价',
  variant: 'primary' as const,
  kind: 'chat.sendMessage' as const,
  params: { text: '提交报价', skillSlugs: ['quote-assistant'] },
};

const reuploadAction = {
  id: 'reupload',
  label: '重新上传报价表',
  variant: 'secondary' as const,
  kind: 'composer.openFilePicker' as const,
  params: { accept: '.xlsx,.xls,.csv', multiple: false },
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
    expect(isQuoteReuploadAction(reuploadAction)).toBe(true);
    expect(isQuoteReuploadAction(submitAction)).toBe(false);
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

  it('hides submit and re-upload on ready_to_save and prompts chat submit', () => {
    const card = createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'ready_to_save',
      body: '报价对象 王豪生 校验通过。',
      data: { validationOutcome: 'pass', ossKey: 'vip/osstmp/x' },
      actions: [submitAction, reuploadAction, openDetailAction],
    });
    expect(shouldHideQuoteSubmitActions(card)).toBe(true);
    expect(filterQuoteFlowCardActions(card, card.actions ?? [])).toEqual([openDetailAction]);
    const normalized = normalizeQuoteFlowCard(card);
    expect(normalized.actions).toEqual([openDetailAction]);
    expect(normalized.body).toContain('请在下方对话框输入「提交报价」');
    expect(normalized.body).toContain('重新上传报价表');
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

  it('normalizes quote upload card text and forces single-file picker', () => {
    const card = normalizeQuoteFlowCard(createFlowCardBlock({
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'awaiting_upload',
      hint: '选择文件后将直接发送并开始解析；支持一次多选。',
      actions: [{
        id: 'upload',
        label: '上传报价表(支持多选文件)',
        kind: 'composer.openFilePicker',
        params: { accept: '.xlsx,.xls,.csv', multiple: true },
      }],
    }));

    expect(card.hint).toBe('选择文件后将直接发送并开始解析');
    expect(card.actions?.[0]?.label).toBe('上传报价表');
    expect(card.actions?.[0]?.params?.multiple).toBe(false);
  });
});
