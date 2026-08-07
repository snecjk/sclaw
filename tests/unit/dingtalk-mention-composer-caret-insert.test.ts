import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeSlashTriggerText,
  insertSkillSpan,
  insertWorkflowSpan,
  readCaretPlainTextOffset,
  serializeMentionEditor,
  SKILL_SPAN_SELECTOR,
  WORKFLOW_SPAN_SELECTOR,
} from '@/lib/dingtalk-mention-composer';

/** contentEditable 需要挂到 document 上，caret 才有真实 Selection。 */
function mountEditor(text: string): { root: HTMLElement; textNode: Text } {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  const textNode = document.createTextNode(text);
  root.appendChild(textNode);
  document.body.appendChild(root);
  return { root, textNode };
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('composer token 光标处插入', () => {
  it('技能标签插在光标处而不是编辑器最前面', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, textNode.length);

    insertSkillSpan(root, 'transit-rate', '中转费率查询');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill?.slug).toBe('transit-rate');
    expect(snapshot.skillOffset).toBe('查看一下这个技能'.length);
    expect(snapshot.plainText.startsWith('查看一下这个技能')).toBe(true);
  });

  it('光标在句子中间时技能标签落在中间', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, 4);

    insertSkillSpan(root, 'transit-rate', '中转费率查询');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skillOffset).toBe(4);
    // 标签自带的分隔空格留在正文里，作为标签与后文的间隔
    expect(snapshot.plainText).toBe('查看一下 这个技能');
  });

  it('技能标签在最前时仍剥掉它自带的分隔空格', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, 0);

    insertSkillSpan(root, 'transit-rate', '中转费率查询');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skillOffset).toBe(0);
    expect(snapshot.plainText).toBe('查看一下这个技能');
  });

  it('工作流标签同样插在光标处而不是追加到末尾', () => {
    const { root, textNode } = mountEditor('查看一下这个工作流');
    placeCaret(textNode, 4);

    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.plainText).toBe('查看一下测试环境-html工作流 这个工作流');
  });

  it('光标不在编辑器内时退回到末尾插入', () => {
    const { root } = mountEditor('查看一下');
    window.getSelection()?.removeAllRanges();

    insertSkillSpan(root, 'transit-rate', '中转费率查询');

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skillOffset).toBe('查看一下'.length);
  });

  it('替换标签时新标签落在当前光标处，且旧标签被移除', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, 0);
    insertSkillSpan(root, 'transit-rate', '中转费率查询');
    expect(serializeMentionEditor(root).skillOffset).toBe(0);

    const tail = root.lastChild as Text;
    placeCaret(tail, tail.length);
    insertSkillSpan(root, 'site-quote', '网点面单报价');

    const snapshot = serializeMentionEditor(root);
    expect(root.querySelectorAll(SKILL_SPAN_SELECTOR)).toHaveLength(1);
    expect(snapshot.skill?.slug).toBe('site-quote');
    expect(snapshot.skillOffset).toBe('查看一下这个技能'.length);
  });

  it('显式传入下标时按下标落位（编辑重发还原）', () => {
    const { root } = mountEditor('查看一下这个技能');
    window.getSelection()?.removeAllRanges();

    insertSkillSpan(root, 'transit-rate', '中转费率查询', 4);

    expect(serializeMentionEditor(root).skillOffset).toBe(4);
  });

  it('下标为 0 时还原成标签在最前', () => {
    const { root } = mountEditor('查看一下这个技能');
    window.getSelection()?.removeAllRanges();

    insertSkillSpan(root, 'transit-rate', '中转费率查询', 0);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skillOffset).toBe(0);
    expect(snapshot.plainText).toBe('查看一下这个技能');
  });

  it('工具栏选中：记录光标后失焦，仍按原位置插入技能', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, 4);
    const savedOffset = readCaretPlainTextOffset(root);
    expect(savedOffset).toBe(4);

    // 模拟点击工具栏/浮层导致 editor 失焦
    window.getSelection()?.removeAllRanges();
    expect(readCaretPlainTextOffset(root)).toBeNull();

    insertSkillSpan(root, 'flat-rate', '一口价报价', savedOffset ?? undefined);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skillOffset).toBe(4);
    expect(snapshot.plainText).toBe('查看一下 这个技能');
  });

  it('工具栏选中：记录光标后失焦，仍按原位置插入工作流', () => {
    const { root, textNode } = mountEditor('查看一下这个工作流');
    placeCaret(textNode, 4);
    const savedOffset = readCaretPlainTextOffset(root);
    window.getSelection()?.removeAllRanges();

    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine', savedOffset ?? undefined);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.plainText).toBe('查看一下测试环境-html工作流 这个工作流');
  });

  it('slash 选中技能：即使点选浮层导致失焦，标签仍落在 / 原位置而不是文字前面', () => {
    const { root, textNode } = mountEditor('查看一下这个技能/一口');
    placeCaret(textNode, textNode.length);
    // 模拟点击浮层：编辑器失焦、Selection 被清空
    window.getSelection()?.removeAllRanges();

    const offset = consumeSlashTriggerText(root, '一口');
    expect(offset).toBe('查看一下这个技能'.length);
    insertSkillSpan(root, 'flat-rate', '一口价报价', offset ?? undefined);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.skill?.slug).toBe('flat-rate');
    expect(snapshot.skillOffset).toBe('查看一下这个技能'.length);
    expect(snapshot.plainText.startsWith('查看一下这个技能')).toBe(true);
    expect(root.firstChild).not.toBe(root.querySelector(SKILL_SPAN_SELECTOR));
  });

  it('slash 选中工作流：失焦后仍落在 / 原位置', () => {
    const { root, textNode } = mountEditor('查看一下这个工作流/html');
    placeCaret(textNode, textNode.length);
    window.getSelection()?.removeAllRanges();

    const offset = consumeSlashTriggerText(root, 'html');
    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine', offset ?? undefined);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.plainText.startsWith('查看一下这个工作流')).toBe(true);
  });

  it('技能与工作流互斥时，替换发生在光标处', () => {
    const { root, textNode } = mountEditor('查看一下这个技能');
    placeCaret(textNode, textNode.length);
    insertSkillSpan(root, 'transit-rate', '中转费率查询');

    const tail = root.lastChild as Text;
    placeCaret(tail, tail.length);
    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine');

    const snapshot = serializeMentionEditor(root);
    expect(root.querySelectorAll(SKILL_SPAN_SELECTOR)).toHaveLength(0);
    expect(root.querySelectorAll(WORKFLOW_SPAN_SELECTOR)).toHaveLength(1);
    expect(snapshot.skill).toBeUndefined();
    expect(snapshot.skillOffset).toBeUndefined();
    expect(snapshot.workflowId).toBe('wf_a');
  });
});
