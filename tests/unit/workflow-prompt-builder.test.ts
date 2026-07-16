import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/StoClawData', isPackaged: false },
}));

import { buildPrompt, runWorkspacePath, workspacePath } from '../../electron/services/workflow-runtime/prompt-builder';
import { compileAgentRunSpec } from '../../electron/services/workflow-runtime/agent-spec';
import type { AgentRunSpec } from '../../electron/services/workflow-runtime/types';

function makeSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  const spec: AgentRunSpec = {
    schemaVersion: 'agent-run-spec/v1', workflowId: 'wf-1', workflowVersion: 1, runId: 'run-1', nodeId: 'node-1',
    task: { name: '智能加工', goal: '整理销售数据', instruction: '按月汇总' },
    target: { provider: 'client_local', kind: 'agent_data_process' },
    inputs: { source: { processFiles: [{ filePath: 'C:/input.json', name: 'input.json' }] } },
    allowedSkills: [], allowedTools: [], outputSchema: 'generic_data_result',
    runtimeContext: { smartNode: { kind: 'agent_data_process' }, startup: { schema: { fields: [{ key: 'region', label: '区域', description: '目标区域' }] }, resolvedInputs: { region: '华东' } }, isFirstAgentNode: true },
    permissionPolicy: { mode: 'readonly', requireApprovalForTools: [] }, limits: {},
    completionContract: { resultKind: 'generic_data_result', contentMode: 'structured_json', outputJsonSchema: { type: 'object', required: ['kind', 'data'], properties: { kind: { type: 'string' }, data: { type: 'object' } } } }, prompt: '',
  };
  return { ...spec, ...overrides, task: { ...spec.task, ...(overrides.task ?? {}) }, runtimeContext: { ...spec.runtimeContext, ...(overrides.runtimeContext ?? {}) }, completionContract: { ...spec.completionContract, ...(overrides.completionContract ?? {}) } };
}

describe('buildPrompt', () => {
  it('renders smart processing context, startup hints, and local process-file paths', () => {
    const prompt = buildPrompt(makeSpec(), { runId: 'run-1', nodeId: 'node-1' });
    expect(prompt).toContain('# 当前节点回合');
    expect(prompt).toContain('启动参数说明：');
    expect(prompt).toContain('区域（key: region）');
    expect(prompt).toContain('这是智能加工节点，不是普通总结节点。');
    expect(prompt).toContain('kind:string 必填');
    expect(prompt).not.toContain('必填字段：');
    expect(prompt).toContain(workspacePath('run-1', 'node-1').replace(/\\/g, '/'));
    expect(prompt).toContain(runWorkspacePath('run-1').replace(/\\/g, '/'));
    expect(prompt).not.toContain('/runtime/outputs/');
  });

  it('renders condition constraints and excludes startup inputs after the first agent node', () => {
    const prompt = buildPrompt(makeSpec({
      task: { name: '智能判断', goal: '路由', instruction: '判断类别' },
      runtimeContext: { smartNode: { kind: 'agent_condition' }, startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: false },
      completionContract: { resultKind: 'agent_condition_route_result', outputJsonSchema: { type: 'object' } },
    }), { runId: 'run-1', nodeId: 'node-1' });
    expect(prompt).toContain('这是智能判断节点，你必须基于输入数据完成路由判断。');
    expect(prompt).toContain('data.branch_key 必须只返回一个值');
    expect(prompt).not.toContain('启动确认参数：');
  });

  it('uses the specialized fetch prompt and removes sensitive transport fields', () => {
    const prompt = buildPrompt(makeSpec({
      task: { name: '智能取数', goal: '提取发票', instruction: '' },
      inputs: { localImport: { files: [{ fileId: 'f1', name: 'invoice.xlsx', ossKey: 'private-key', tempUrl: 'https://secret' }] } },
      runtimeContext: { smartNode: { kind: 'agent_data_fetch' }, startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: true },
      completionContract: { resultKind: 'structured_data_extract_result', outputJsonSchema: { type: 'object' } },
    }), { runId: 'run-1', nodeId: 'node-1' });
    expect(prompt).toContain('这是智能取数节点，不是普通总结节点。');
    expect(prompt).toContain('invoice.xlsx');
    expect(prompt).not.toContain('private-key');
    expect(prompt).not.toContain('https://secret');
  });

  it('compiles condition business configuration into branch and fallback instructions', () => {
    const spec = compileAgentRunSpec({
      id: 'condition-1', type: 'agent_condition', name: '审批路由', config: {
        businessConfig: { subject: '订单金额' },
        agentConfig: { task: { goal: '决定审批路径' } },
        branches: [
          { branchKey: 'approve', label: '通过', routeRuleHint: '金额低于阈值' },
          { branchKey: 'manual', label: '人工复核', isFallback: true },
        ],
      },
    }, { runId: 'run-1', workflowId: 'wf-1', versionId: '1', definition: {}, repo: {} as never, resolvedInputs: {}, startupInputs: {}, startupSchema: {}, isFirstAgentNode: true, emit: async () => undefined });
    const prompt = buildPrompt(spec, { runId: 'run-1', nodeId: 'condition-1' });
    expect(prompt).toContain('branch_key: approve');
    expect(prompt).toContain('如无法确定，返回兜底分支 manual');
  });

  it('enables workspace-local writes for desktop nodes that require approval', () => {
    const spec = compileAgentRunSpec({
      id: 'task-1', type: 'agent_task', name: '生成文件', config: {
        task: { goal: '生成 HTML 文件' },
        guardrails: { approvalMode: 'approval_required' },
      },
    }, { runId: 'run-1', workflowId: 'wf-1', versionId: '1', definition: {}, repo: {} as never, emit: async () => undefined });

    expect(spec.permissionPolicy.mode).toBe('workspace_write');
  });

  it('keeps HTML output and local artifact delivery instructions', () => {
    const prompt = buildPrompt(makeSpec({
      task: { name: '智能输出', goal: '生成页面', instruction: '' },
      runtimeContext: { smartNode: { kind: 'agent_output' }, startup: { schema: {}, resolvedInputs: {} }, isFirstAgentNode: false },
      completionContract: { resultKind: 'generic_data_result', contentMode: 'document_html', outputJsonSchema: { type: 'object' } },
    }), { runId: 'run-1', nodeId: 'node-1' });
    expect(prompt).toContain('这是 HTML 页面场景');
    expect(prompt).toContain('artifacts[].filePath 填写');
    expect(prompt).toContain('不得虚构路径、产物或保存状态');
    expect(prompt).toContain(runWorkspacePath('run-1').replace(/\\/g, '/'));
  });
});
