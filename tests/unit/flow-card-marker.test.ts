import { describe, expect, it } from 'vitest';
import {
  findBareFlowCardJsonInText,
  findFlowCardInText,
  findStreamingFlowCardInText,
  hasOpenFlowCardFence,
  isFlowCardCompanionText,
  parseFlowCardFence,
  parseFlowCardPayload,
  stripFlowCardFences,
} from '@/lib/flow-card-marker';

describe('flow-card-marker', () => {
  it('parses a flow_card fenced payload', () => {
    const text = [
      '开始处理。',
      '```flow_card',
      JSON.stringify({
        cardId: 'card-1',
        phase: 'awaiting_upload',
        title: '上传',
        actions: [{
          id: 'upload',
          label: '上传',
          kind: 'composer.openFilePicker',
        }],
      }),
      '```',
    ].join('\n');

    const parsed = parseFlowCardFence(text);
    expect(parsed?.cardId).toBe('card-1');
    expect(parsed?.phase).toBe('awaiting_upload');
    expect(parsed?.actions?.[0]?.kind).toBe('composer.openFilePicker');
  });

  it('strips flow_card fences from assistant text', () => {
    const stripped = stripFlowCardFences('说明\n```flow_card\n{"cardId":"c","phase":"x"}\n```\n');
    expect(stripped).toBe('说明');
  });

  it('parses fence without newline before closing ticks', () => {
    const text = '```flow_card\n{"cardId":"c","phase":"awaiting_upload","title":"开始"}```';
    expect(parseFlowCardFence(text)?.cardId).toBe('c');
  });

  it('parses bare JSON after intro text (model omitted flow_card fence)', () => {
    const payload = {
      cardId: 'quote-active',
      domain: 'quote',
      phase: 'awaiting_upload',
      title: '好的，开始**新建报价**。',
      actions: [{
        id: 'upload',
        label: '上传报价表',
        kind: 'composer.openFilePicker',
      }],
    };
    const text = [
      '好的，请点击下方按钮上传报价表文件（支持 .xlsx / .xls / .csv，可多选）。',
      JSON.stringify(payload, null, 2),
    ].join('\n\n');

    expect(findBareFlowCardJsonInText(text)?.cardId).toBe('quote-active');
    expect(findFlowCardInText(text)?.phase).toBe('awaiting_upload');
    expect(stripFlowCardFences(text)).toBe(
      '好的，请点击下方按钮上传报价表文件（支持 .xlsx / .xls / .csv，可多选）。',
    );
  });

  it('strips companion validation text when flow_card fence is present', () => {
    const text = '校验通过!\n```flow_card\n{"cardId":"c","phase":"validating"}\n```';
    expect(stripFlowCardFences(text)).toBe('');
  });

  it('detects open flow_card fence during streaming', () => {
    const text = '校验通过\n```flow_card\n{"cardId":"quote-active","phase":"validating","data":{"progressSteps":[';
    expect(hasOpenFlowCardFence(text)).toBe(true);
    const parsed = findStreamingFlowCardInText(text);
    expect(parsed?.cardId).toBe('quote-active');
    expect(parsed?.phase).toBe('validating');
  });

  it('treats validation status lines as companion text', () => {
    expect(isFlowCardCompanionText('校验通过!')).toBe(true);
    expect(isFlowCardCompanionText('报价对象 王豪生/V236330000002 校验通过。')).toBe(true);
    expect(isFlowCardCompanionText('请点击下方按钮上传报价表。')).toBe(false);
  });
});
