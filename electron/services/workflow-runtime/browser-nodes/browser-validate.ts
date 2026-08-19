import type { RunCtx, NodeResult } from '../types';
import {
  buildBrowserFailurePacket,
  buildBrowserSuccessPacket,
  readValidators,
  resolveBrowserSession,
} from './session-resolver';
import { browserAutomationService } from '../../browser-automation/service';

export async function executeBrowserValidateNode(
  ctx: RunCtx,
  node: any,
  nodeInput: unknown,
): Promise<NodeResult> {
  const validators = readValidators(node);
  if (!validators.length) {
    throw new Error(`browser_validate 节点 ${node.id} 缺少 validators 配置`);
  }

  const { sessionId, payload: sessionPayload } = await resolveBrowserSession({
    node,
    nodeInput,
    runId: ctx.runId,
  });

  const baRunId = await browserAutomationService.startRun(sessionId, {
    workflowRunId: ctx.runId,
  });

  const validationResults = [];
  for (const spec of validators) {
    const result = await browserAutomationService.validate(sessionId, spec, baRunId);
    validationResults.push(result);
    if (!result.passed) {
      const onFail = node?.config?.onFail ?? 'fail';
      const failedPayload = {
        ...sessionPayload,
        baRunId,
        validationResults,
        status: 'failed' as const,
        error: result.message,
      };
      if (onFail === 'human_gate') {
        return {
          action: 'pause',
          output: buildBrowserSuccessPacket(ctx, node, failedPayload, {
            waitingReason: result.message,
            waitingKind: 'browser_validation_failed',
          }),
        };
      }
      return {
        action: 'continue',
        output: buildBrowserFailurePacket(ctx, node, result.message),
      };
    }
  }

  let observation;
  try {
    observation = await browserAutomationService.observe(sessionId);
  } catch {
    observation = undefined;
  }

  await browserAutomationService.completeRun(baRunId, 'SUCCEEDED');

  return {
    action: 'continue',
    output: buildBrowserSuccessPacket(ctx, node, {
      ...sessionPayload,
      baRunId,
      validationResults,
      status: 'succeeded',
      url: observation?.url ?? sessionPayload.url,
      title: observation?.title ?? sessionPayload.title,
      lastObservation: observation,
    }),
  };
}

export async function executeBrowserHumanGateNode(
  ctx: RunCtx,
  node: any,
  nodeInput: unknown,
): Promise<NodeResult> {
  const { sessionId, payload: sessionPayload } = await resolveBrowserSession({
    node,
    nodeInput,
    runId: ctx.runId,
  });

  let observation;
  try {
    observation = await browserAutomationService.observe(sessionId);
  } catch {
    observation = undefined;
  }

  return {
    action: 'pause',
    output: buildBrowserSuccessPacket(ctx, node, {
      ...sessionPayload,
      status: 'paused',
      url: observation?.url ?? sessionPayload.url,
      title: observation?.title ?? sessionPayload.title,
      lastObservation: observation,
    }, {
      waitingReason: node?.config?.reason ?? '等待人工确认浏览器操作',
      waitingKind: 'browser_human_gate',
    }),
  };
}
