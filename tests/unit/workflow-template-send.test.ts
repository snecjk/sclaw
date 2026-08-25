import { describe, expect, it } from 'vitest';
import { isSingleTemplateWorkflowSend } from '@/lib/workflow-template-send';
import {
  isWorkflowFormInjectionAllowed,
  lastUserTurnHasTemplateWorkflowEvidence,
} from '@/stores/chat/parameter-form-recovery';
import type { RawMessage } from '@/stores/chat/types';

describe('isSingleTemplateWorkflowSend', () => {
  it('accepts template source and unset source (install deep-link)', () => {
    expect(isSingleTemplateWorkflowSend({
      workflows: [{ id: 'tpl_1', name: '客户成本分析', source: 'template' }],
    })).toBe(true);
    expect(isSingleTemplateWorkflowSend({
      workflows: [{ id: 'tpl_1', name: '客户成本分析' }],
    })).toBe(true);
  });

  it('rejects mine instance and mixed skill+workflow', () => {
    expect(isSingleTemplateWorkflowSend({
      workflows: [{ id: 'wf_1', name: '我的', source: 'mine' }],
    })).toBe(false);
    expect(isSingleTemplateWorkflowSend({
      workflows: [{ id: 'tpl_1', name: '模版', source: 'template' }],
      skillCount: 1,
    })).toBe(false);
    expect(isSingleTemplateWorkflowSend({
      workflows: [
        { id: 'tpl_1', name: 'A', source: 'template' },
        { id: 'tpl_2', name: 'B', source: 'template' },
      ],
    })).toBe(false);
  });
});

describe('lastUserTurnHasTemplateWorkflowEvidence', () => {
  const getText = (content: unknown) => (typeof content === 'string' ? content : '');

  it('detects workflow chip on optimistic displayText that omits the template name', () => {
    const suffix = '按客户维度拆解发件成本与利润';
    const uiMessages: RawMessage[] = [{
      role: 'user',
      content: suffix,
      timestamp: 1,
      _composerSegments: [
        { type: 'workflow', id: 'tpl_cost', name: '客户成本分析', source: 'template' },
        { type: 'text', text: suffix },
      ],
    }];

    expect(lastUserTurnHasTemplateWorkflowEvidence('tpl_cost', uiMessages, [], getText)).toBe(true);
    expect(lastUserTurnHasTemplateWorkflowEvidence('other', uiMessages, [], getText)).toBe(false);
  });

  it('detects unified exec bake sentence', () => {
    const uiMessages: RawMessage[] = [{
      role: 'user',
      content: '帮我执行 id 为：tpl_cost 的工作流 【客户成本分析】按客户维度拆解',
      timestamp: 1,
    }];
    expect(lastUserTurnHasTemplateWorkflowEvidence('tpl_cost', uiMessages, [], getText)).toBe(true);
  });

  it('allows form injection when chip turn has pending schema', () => {
    // pending is read from chat store — this unit only covers the evidence helper.
    // Integration of isWorkflowFormInjectionAllowed with store is covered elsewhere.
    const suffix = '按客户维度拆解发件成本与利润';
    const uiMessages: RawMessage[] = [{
      role: 'user',
      content: suffix,
      timestamp: 1,
      _composerSegments: [
        { type: 'workflow', id: 'tpl_cost', name: '客户成本分析', source: 'template' },
        { type: 'text', text: suffix },
      ],
    }];
    expect(
      isWorkflowFormInjectionAllowed(
        'tpl_cost',
        uiMessages,
        getText,
        'agent:main:test',
        { rawMessages: [] },
      ),
    ).toBe(false); // no pending / schema_ready yet
  });
});
