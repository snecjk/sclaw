import { describe, expect, it } from 'vitest';
import {
  consumeSlashTriggerText,
  insertSkillSpan,
  insertWorkflowSpan,
  serializeMentionEditor,
  WORKFLOW_SPAN_SELECTOR,
} from '@/lib/dingtalk-mention-composer';

describe('dingtalk-mention-composer workflow token', () => {
  it('allows stacking multiple workflow tokens', () => {
    const root = document.createElement('div');
    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine');
    insertWorkflowSpan(root, 'wf_b', 'PPT工作流测试', 'mine');

    expect(root.querySelectorAll(WORKFLOW_SPAN_SELECTOR)).toHaveLength(2);

    const snapshot = serializeMentionEditor(root);
    expect(snapshot.workflows).toHaveLength(2);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.workflowName).toBe('测试环境-html工作流');
    expect(snapshot.plainText).toContain('测试环境-html工作流');
    expect(snapshot.plainText).toContain('PPT工作流测试');
  });

  it('re-triggering slash on top of a workflow token leaves no slash residue', () => {
    const root = document.createElement('div');
    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine');

    // 用户在已有工作流标签后继续输入 `/ppt` 唤起浮层
    const spacer = root.lastChild as Text;
    spacer.data = `${spacer.data}/ppt`;

    const offset = consumeSlashTriggerText(root, 'ppt');
    insertWorkflowSpan(root, 'wf_b', 'PPT工作流测试', 'mine', offset ?? undefined);

    const snapshot = serializeMentionEditor(root);
    expect(root.querySelectorAll(WORKFLOW_SPAN_SELECTOR)).toHaveLength(2);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.workflows.map((w) => w.id)).toEqual(['wf_a', 'wf_b']);
    expect(snapshot.plainText).not.toContain('/');
    expect(snapshot.plainText).not.toContain('ppt');
  });

  it('workflow and skill can coexist', () => {
    const root = document.createElement('div');

    insertSkillSpan(root, 'transit-rate', '中转费率查询');
    insertWorkflowSpan(root, 'wf_a', '测试环境-html工作流', 'mine');
    let snapshot = serializeMentionEditor(root);
    expect(snapshot.skill?.slug).toBe('transit-rate');
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.workflows).toHaveLength(1);

    insertSkillSpan(root, 'site-quote', '网点面单报价');
    snapshot = serializeMentionEditor(root);
    expect(root.querySelectorAll(WORKFLOW_SPAN_SELECTOR)).toHaveLength(1);
    expect(snapshot.workflowId).toBe('wf_a');
    expect(snapshot.skills).toHaveLength(2);
    expect(snapshot.skill?.slug).toBe('transit-rate');
  });
});
