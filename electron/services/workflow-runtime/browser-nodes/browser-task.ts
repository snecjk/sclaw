import type { RunCtx, NodeResult } from '../types';
import { runAgentNodeWithRetry, type InvokeAgentFn } from '../agent-retry';
import { compileBrowserAgentSpec } from './compile-browser-spec';
import {
  buildBrowserFailurePacket,
  buildBrowserSuccessPacket,
  resolveBrowserSession,
} from './session-resolver';
import { browserAutomationService } from '../../browser-automation/service';
import { browserAutomationRepository } from '../../../db/repositories/browser-automation-repository';
import { getWorkflowPacketFailureMessage, isWorkflowPacket } from '../workflow-packet';

export async function executeBrowserTaskNode(
  ctx: RunCtx,
  node: any,
  nodeInput: unknown,
  deps: {
    invokeAgent: InvokeAgentFn;
    quota?: () => Promise<boolean>;
    execEngine?: 'claude' | 'openclaw';
    versionId?: unknown;
  },
): Promise<NodeResult> {
  const { sessionId, payload: sessionPayload } = await resolveBrowserSession({
    node,
    nodeInput,
    runId: ctx.runId,
  });

  const inheritedBaRunId = sessionPayload.baRunId;
  const baRunId = inheritedBaRunId && node?.config?.resume !== false
    ? inheritedBaRunId
    : await browserAutomationService.startRun(sessionId, { workflowRunId: ctx.runId });

  const spec = compileBrowserAgentSpec(node, ctx, deps.versionId, {
    sessionId,
    baRunId,
    sessionPayload,
  });

  const agentResult = await runAgentNodeWithRetry(ctx, node, spec, {
    invokeAgent: deps.invokeAgent,
    quota: deps.quota,
    execEngine: deps.execEngine,
  });

  if (agentResult.status === 'manual_review') {
    return { action: 'pause', output: agentResult.output };
  }

  if (agentResult.status === 'failed') {
    await browserAutomationService.completeRun(baRunId, 'FAILED');
    const failurePacket = isWorkflowPacket(agentResult.output)
      ? agentResult.output
      : buildBrowserFailurePacket(
        ctx,
        node,
        agentResult.error ?? getWorkflowPacketFailureMessage(agentResult.output as any) ?? '浏览器任务执行失败',
      );
    return { action: 'continue', output: failurePacket };
  }

  let observation;
  try {
    observation = await browserAutomationService.observe(sessionId);
  } catch {
    observation = undefined;
  }

  const stepRuns = await browserAutomationRepository.listStepRuns(baRunId);
  await browserAutomationService.completeRun(baRunId, 'SUCCEEDED');

  const browserPayload = {
    ...sessionPayload,
    sessionId,
    baRunId,
    status: 'succeeded' as const,
    url: observation?.url ?? sessionPayload.url,
    title: observation?.title ?? sessionPayload.title,
    lastObservation: observation,
    stepsCompleted: stepRuns.length,
  };

  if (isWorkflowPacket(agentResult.output)) {
    const agentPayload = agentResult.output.payload;
    const mergedPayload = agentPayload && typeof agentPayload === 'object' && !Array.isArray(agentPayload)
      ? { ...(agentPayload as Record<string, unknown>), browser: browserPayload }
      : { browser: browserPayload };
    return {
      action: 'continue',
      output: {
        ...agentResult.output,
        payload: mergedPayload,
      },
    };
  }

  return {
    action: 'continue',
    output: buildBrowserSuccessPacket(ctx, node, browserPayload),
  };
}
