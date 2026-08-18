import { describe, expect, it } from 'vitest';
import {
  BROWSER_AGENT_ALLOWED_TOOLS,
  BROWSER_WORKFLOW_NODE_TYPES,
  isBrowserWorkflowNodeType,
} from '../../shared/browser-automation/workflow-output';
import { compileBrowserAgentSpec } from '../../electron/services/workflow-runtime/browser-nodes/compile-browser-spec';
import {
  extractBrowserPayload,
  readValidators,
} from '../../electron/services/workflow-runtime/browser-nodes/session-resolver';
import { buildWorkflowNodePrompt } from '../../electron/services/workflow-runtime/prompt-builder';
import type { AgentRunSpec, RunCtx } from '../../electron/services/workflow-runtime/types';

describe('browser workflow node types', () => {
  it('registers expected node types', () => {
    expect(BROWSER_WORKFLOW_NODE_TYPES).toEqual([
      'browser_task',
      'browser_validate',
      'browser_human_gate',
    ]);
    expect(isBrowserWorkflowNodeType('browser_task')).toBe(true);
    expect(isBrowserWorkflowNodeType('agent_task')).toBe(false);
  });

  it('restricts browser agent tools to ba_* set', () => {
    expect(BROWSER_AGENT_ALLOWED_TOOLS).toEqual([
      'ba_create_session',
      'ba_observe',
      'ba_act',
      'ba_wait',
      'ba_validate',
      'ba_start_run',
    ]);
  });
});

describe('browser workflow payload extraction', () => {
  it('extracts browser payload from nested workflow packet', () => {
    const input = {
      upstream: {
        protocolVersion: 'workflow-packet/v1',
        payload: {
          browser: {
            sessionId: 'embed-app-1',
            status: 'succeeded',
          },
        },
      },
    };
    expect(extractBrowserPayload(input)).toMatchObject({
      sessionId: 'embed-app-1',
      status: 'succeeded',
    });
  });

  it('extracts browser payload from direct browser field', () => {
    expect(extractBrowserPayload({
      browser: { sessionId: 'managed-1', status: 'succeeded' },
    })).toMatchObject({ sessionId: 'managed-1' });
  });
});

describe('browser workflow validators config', () => {
  it('reads validators array', () => {
    const node = {
      config: {
        validators: [{ kind: 'text_present', text: '提交成功' }],
      },
    };
    expect(readValidators(node)).toHaveLength(1);
  });

  it('reads single validator object', () => {
    const node = {
      config: {
        validator: { kind: 'url_contains', value: '/home' },
      },
    };
    expect(readValidators(node)).toEqual([{ kind: 'url_contains', value: '/home' }]);
  });
});

describe('compileBrowserAgentSpec', () => {
  const ctx: RunCtx = {
    runId: 'run-1',
    workflowId: 'wf-1',
    versionId: 'v1',
    emit: async () => {},
  };

  it('whitelists ba_* tools and injects browser context', () => {
    const spec = compileBrowserAgentSpec(
      { id: 'n1', type: 'browser_task', config: { goal: '点击提交按钮' } },
      ctx,
      'v1',
      {
        sessionId: 'embed-app-1',
        baRunId: 'ba-run-1',
        sessionPayload: { sessionId: 'embed-app-1', status: 'succeeded' },
      },
    );
    expect(spec.allowedTools).toEqual([...BROWSER_AGENT_ALLOWED_TOOLS]);
    expect(spec.task.goal).toBe('点击提交按钮');
    expect((spec.runtimeContext as Record<string, unknown>).browserAutomation).toMatchObject({
      sessionId: 'embed-app-1',
      baRunId: 'ba-run-1',
    });
    expect(spec.permissionPolicy?.mode).toBe('readonly');
  });
});

describe('buildBrowserTaskPrompt', () => {
  it('includes browser session and ba_* tool constraints', () => {
    const spec: AgentRunSpec = {
      schemaVersion: 'agent-run-spec/v1',
      workflowId: 'wf-1',
      workflowVersion: 'v1',
      runId: 'run-1',
      nodeId: 'n1',
      task: { goal: '填写表单并提交' },
      target: { provider: 'client_local', kind: 'browser_task' },
      inputs: {},
      allowedSkills: [],
      allowedTools: [...BROWSER_AGENT_ALLOWED_TOOLS],
      outputSchema: '',
      metadata: {},
      runtimeContext: {
        browserAutomation: { sessionId: 'embed-app-1', baRunId: 'ba-run-1' },
      },
      permissionPolicy: { mode: 'readonly' },
      limits: { maxToolCalls: 15 },
      completionContract: { dataJsonSchema: { type: 'object' } },
      guardrails: {},
      prompt: '',
    };
    const ctx: RunCtx = {
      runId: 'run-1',
      workflowId: 'wf-1',
      versionId: 'v1',
      resolvedInputs: { browser: { sessionId: 'embed-app-1', status: 'succeeded' } },
      emit: async () => {},
    };
    const prompt = buildWorkflowNodePrompt(spec, { id: 'n1', type: 'browser_task' }, ctx, { execEngine: 'openclaw' });
    expect(prompt).toContain('浏览器任务节点');
    expect(prompt).toContain('embed-app-1');
    expect(prompt).toContain('ba_observe');
    expect(prompt).toContain('填写表单并提交');
  });

  it('includes resume instructions when checkpoint exists', () => {
    const spec: AgentRunSpec = {
      schemaVersion: 'agent-run-spec/v1',
      workflowId: 'wf-1',
      workflowVersion: 'v1',
      runId: 'run-1',
      nodeId: 'n1',
      task: { goal: '继续提交表单' },
      target: { provider: 'client_local', kind: 'browser_task' },
      inputs: {},
      allowedSkills: [],
      allowedTools: [...BROWSER_AGENT_ALLOWED_TOOLS],
      outputSchema: '',
      metadata: {},
      runtimeContext: {
        browserAutomation: {
          sessionId: 'embed-app-1',
          baRunId: 'ba-run-1',
          resume: {
            isResume: true,
            baRunId: 'ba-run-1',
            stepsCompleted: 2,
            lastStep: { action: 'click', status: 'SUCCEEDED' },
          },
        },
      },
      permissionPolicy: { mode: 'readonly' },
      limits: { maxToolCalls: 15 },
      completionContract: { dataJsonSchema: { type: 'object' } },
      guardrails: {},
      prompt: '',
    };
    const ctx: RunCtx = {
      runId: 'run-1',
      workflowId: 'wf-1',
      versionId: 'v1',
      emit: async () => {},
    };
    const prompt = buildWorkflowNodePrompt(spec, { id: 'n1', type: 'browser_task' }, ctx);
    expect(prompt).toContain('恢复执行');
    expect(prompt).toContain('已完成 2 步');
    expect(prompt).toContain('ba_observe');
  });
});
