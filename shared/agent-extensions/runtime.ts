import type {
  SclawAfterToolEvent,
  SclawBeforeToolDecision,
  SclawBeforeToolEvent,
  SclawExtensionBuildContext,
  SclawExtensionDiagnostic,
  SclawPromptContribution,
  SclawToolPolicy,
} from './types';

export async function buildSclawPrompt(
  extensionId: string,
  prompts: readonly SclawPromptContribution[],
  context: SclawExtensionBuildContext,
  diagnostics: SclawExtensionDiagnostic[],
): Promise<string | undefined> {
  const blocks: string[] = [];
  for (const prompt of prompts) {
    try {
      if (prompt.text?.trim()) blocks.push(prompt.text.trim());
      const dynamic = await prompt.build?.(context);
      if (dynamic?.trim()) blocks.push(dynamic.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        extensionId,
        contributionId: prompt.id,
        code: 'PROMPT_BUILD_FAILED',
        message,
      });
      context.logger.warn(`[agent-extension:${extensionId}] prompt contribution failed`, {
        contributionId: prompt.id,
        error: message,
      });
    }
  }
  return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}

export async function runSclawBeforeToolPolicies(
  extensionId: string,
  policies: readonly SclawToolPolicy[],
  event: SclawBeforeToolEvent,
  context: SclawExtensionBuildContext,
): Promise<SclawBeforeToolDecision> {
  let input = event.input;
  for (const policy of policies) {
    if (!policy.beforeTool) continue;
    try {
      const decision = await policy.beforeTool({ ...event, input }, context);
      if (!decision || decision.action === 'allow') continue;
      if (decision.action === 'deny') return decision;
      input = decision.input;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error(`[agent-extension:${extensionId}] before-tool policy failed`, {
        policyId: policy.id,
        error: message,
      });
      return {
        action: 'deny',
        reason: `Extension policy ${policy.id} failed safely: ${message}`,
      };
    }
  }
  return input === event.input ? { action: 'allow' } : { action: 'patch', input };
}

export async function runSclawAfterToolPolicies(
  extensionId: string,
  policies: readonly SclawToolPolicy[],
  event: SclawAfterToolEvent,
  context: SclawExtensionBuildContext,
): Promise<void> {
  for (const policy of policies) {
    if (!policy.afterTool) continue;
    try {
      await policy.afterTool(event, context);
    } catch (error) {
      context.logger.warn(`[agent-extension:${extensionId}] after-tool policy failed`, {
        policyId: policy.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
