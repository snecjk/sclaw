import { BROWSER_AGENT_ALLOWED_TOOLS } from '../../../../shared/browser-automation/workflow-output';
import type { BrowserWorkflowPayload } from '../../../../shared/browser-automation/workflow-output';
import type { AgentRunSpec, RunCtx } from '../types';
import { workspacePath } from '../workspace-paths';
import { normalizeArtifactFirstPayloadSchema } from '../artifact-output';

import type { BrowserTaskResumeContext } from './resume-context';

export function compileBrowserAgentSpec(
  node: any,
  ctx: RunCtx,
  versionId: unknown,
  browserContext: {
    sessionId: string;
    baRunId: string;
    sessionPayload: BrowserWorkflowPayload;
    resume?: BrowserTaskResumeContext;
  },
): AgentRunSpec {
  const config = node?.config ?? {};
  const agent = config.agentConfig ?? {};
  const task = agent.task ?? config.task ?? {};
  const guardrails = agent.guardrails ?? config.guardrails ?? {};
  const completionContract = guardrails.completionContract ?? config.completionContract ?? {};
  const maxSteps = config.maxSteps ?? guardrails.maxToolCalls ?? 20;
  const configuredSchema = config.outputContract?.schema
    ?? completionContract.dataJsonSchema
    ?? {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '浏览器任务完成摘要' },
      },
    };

  return {
    schemaVersion: 'agent-run-spec/v1',
    workflowId: ctx.workflowId,
    workflowVersion: String(versionId ?? ''),
    runId: ctx.runId,
    nodeId: node.id,
    task: {
      name: task.name ?? node.name ?? node.id,
      goal: task.goal ?? config.goal ?? config.instruction ?? '',
      instruction: task.instruction ?? '',
      outputSchema: task.outputSchema,
    },
    target: {
      provider: 'client_local',
      kind: 'browser_task',
      model: agent.model ?? config.model,
    },
    inputs: agent.inputs ?? config.inputs ?? config.input ?? {},
    allowedSkills: [],
    allowedTools: [...BROWSER_AGENT_ALLOWED_TOOLS],
    outputSchema: '',
    metadata: { browserAutomation: browserContext },
    runtimeContext: {
      browserAutomation: browserContext,
      smartNode: { kind: 'browser_task' },
      startup: { schema: ctx.startupSchema ?? {}, resolvedInputs: ctx.startupInputs ?? {} },
      workspacePath: workspacePath(ctx.runId, node.id),
    } as AgentRunSpec['runtimeContext'],
    permissionPolicy: { mode: 'readonly' },
    limits: {
      timeoutMs: guardrails.timeoutMs ?? config.timeoutMs,
      maxToolCalls: maxSteps,
    },
    completionContract: {
      resultKind: completionContract.resultKind,
      dataJsonSchema: normalizeArtifactFirstPayloadSchema(configuredSchema),
      outputJsonSchema: completionContract.outputJsonSchema ?? { type: 'object' },
      responseExample: completionContract.responseExample,
      maxAttempts: config.maxAttempts ?? completionContract.maxAttempts ?? 2,
      onIncomplete: completionContract.onIncomplete ?? config.onIncomplete ?? 'retry',
    },
    guardrails: { timeoutMs: guardrails.timeoutMs ?? config.timeoutMs },
    prompt: '',
  };
}
