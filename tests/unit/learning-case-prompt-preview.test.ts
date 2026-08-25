import { describe, expect, it } from 'vitest';
import { composeLearningCasePromptPreview } from '@/lib/learning-case-prompt-preview';

describe('composeLearningCasePromptPreview', () => {
  it('hides the prompt box for CHAT when prompt text is empty', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'CHAT',
      promptText: '  ',
    })).toEqual({ visible: false });
  });

  it('shows CHAT prompt text as-is', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'CHAT',
      promptText: '帮我写周报',
    })).toEqual({ visible: true, kind: 'CHAT', text: '帮我写周报' });
  });

  it('shows the selected skill even when the optional suffix is empty', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'SKILL',
      chipTitle: '财务-看报表',
      targetCode: 'finance-guanbao',
      promptText: '',
    })).toEqual({
      visible: true,
      kind: 'SKILL',
      title: '财务-看报表',
      suffix: '',
    });
  });

  it('keeps the skill title and optional suffix separate', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'SKILL',
      chipTitle: '财务-看报表',
      targetCode: 'finance-guanbao',
      promptText: '按本周数据看一眼',
    })).toEqual({
      visible: true,
      kind: 'SKILL',
      title: '财务-看报表',
      suffix: '按本周数据看一眼',
    });
  });

  it('does not expose the workflow target code before the name resolves', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'WORKFLOW',
      targetCode: 'tpl_demo',
      promptText: null,
    })).toEqual({ visible: false });
  });

  it('keeps configured workflow text visible while the name resolves', () => {
    expect(composeLearningCasePromptPreview({
      targetType: 'WORKFLOW',
      targetCode: 'tpl_demo',
      promptText: '按总部数据执行',
    })).toEqual({
      visible: true,
      kind: 'WORKFLOW',
      title: '',
      suffix: '按总部数据执行',
    });
  });
});
