import {
  createSdkMcpServer,
  tool as createClaudeTool,
  type HookCallback,
  type HookCallbackMatcher,
  type HookEvent,
} from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import {
  buildSclawPrompt,
  createSclawActivationEvaluator,
  normalizeSclawToolName,
  runSclawAfterToolPolicies,
  runSclawBeforeToolPolicies,
  sclawToolFailure,
  supportsEngine,
  supportsSessionMode,
  type SclawAgentSessionMode,
  type SclawCommandShell,
  type SclawCapabilityResolver,
  type SclawExtensionBuildContext,
  type SclawExtensionDiagnostic,
  type SclawExtensionLogger,
  type SclawExtensionStateManager,
  type SclawToolOutcome,
  type SclawToolPolicy,
  type SclawToolKind,
} from '../../../../shared/agent-extensions';
import type { ClaudeRuntimeOptions } from '../../../engines/claude-runtime-extensions';
import {
  sclawAgentExtensionCapabilities,
  sclawAgentExtensionLogger,
  sclawAgentExtensionState,
} from '../../runtime';
import {
  isValidAgentExtensionId,
  isValidAgentExtensionResourceName,
  validateAgentExtensionRegistry,
  type RegisteredAgentExtension,
} from '../../registry';
import { typeBoxObjectToZodRawShape } from '../../schema/typebox-to-zod';
import { CLAUDE_AGENT_EXTENSIONS } from './registry';

export interface BuildClaudeAgentExtensionsInput {
  sessionKey: string;
  mode: SclawAgentSessionMode;
  commandShell?: SclawCommandShell;
  userPrompt?: string;
  cwd?: string;
  agentId?: string;
  model?: string;
  accountId?: string;
  runId?: string;
  entries?: readonly RegisteredAgentExtension[];
  capabilities?: SclawCapabilityResolver;
  stateManager?: SclawExtensionStateManager;
  logger?: SclawExtensionLogger;
}

export interface BuildClaudeAgentExtensionsResult {
  options: ClaudeRuntimeOptions;
  diagnostics: SclawExtensionDiagnostic[];
}

function mergeHooks(
  target: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  source: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
): void {
  if (!source) return;
  for (const [event, matchers] of Object.entries(source) as Array<[HookEvent, HookCallbackMatcher[] | undefined]>) {
    if (matchers?.length) target[event] = [...(target[event] ?? []), ...matchers];
  }
}

function mergeOptions(target: ClaudeRuntimeOptions, source: ClaudeRuntimeOptions): void {
  if (source.hooks) {
    target.hooks ??= {};
    mergeHooks(target.hooks, source.hooks);
  }
  if (source.systemPromptAppend?.trim()) {
    target.systemPromptAppend = [target.systemPromptAppend, source.systemPromptAppend.trim()]
      .filter(Boolean)
      .join('\n\n');
  }
  if (source.mcpServers) target.mcpServers = { ...(target.mcpServers ?? {}), ...source.mcpServers };
}

function outcomeResult(outcome: SclawToolOutcome): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(outcome) }],
    isError: !outcome.success,
  };
}

function responseIsError(response: unknown): boolean {
  return Boolean(response && typeof response === 'object' && (response as Record<string, unknown>).isError);
}

function claudeToolKind(toolName: string): SclawToolKind {
  const normalized = normalizeSclawToolName(toolName);
  if (normalized === 'bash') return 'shell';
  if (['read', 'write', 'edit', 'grep', 'glob'].includes(normalized)) return 'filesystem';
  return 'other';
}

function resolveToolCallId(extra: unknown, extensionId: string): string {
  if (extra && typeof extra === 'object') {
    const record = extra as Record<string, unknown>;
    for (const key of ['toolCallId', 'tool_call_id', 'requestId', 'request_id']) {
      if (typeof record[key] === 'string' && record[key]) return record[key];
    }
  }
  return `claude-${extensionId}-${randomUUID()}`;
}

function policyHooks(
  extensionId: string,
  policies: readonly SclawToolPolicy[],
  context: SclawExtensionBuildContext,
  stateManager: SclawExtensionStateManager,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  if (policies.some((policy) => policy.beforeTool)) {
    const callback: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const toolInput = input.tool_input && typeof input.tool_input === 'object'
        ? input.tool_input as Record<string, unknown>
        : {};
      const decision = await runSclawBeforeToolPolicies(extensionId, policies, {
        rawToolName: input.tool_name,
        toolName: normalizeSclawToolName(input.tool_name),
        toolKind: claudeToolKind(input.tool_name),
        toolCallId: input.tool_use_id,
        input: toolInput,
      }, context);
      if (decision.action === 'deny') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          },
        };
      }
      if (decision.action === 'patch') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            updatedInput: decision.input,
          },
        };
      }
      return {};
    };
    hooks.PreToolUse = [{ hooks: [callback] }];
  }

  if (policies.length > 0) {
    const callback: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PostToolUse') return {};
      const toolInput = input.tool_input && typeof input.tool_input === 'object'
        ? input.tool_input as Record<string, unknown>
        : {};
      try {
        await runSclawAfterToolPolicies(extensionId, policies, {
          rawToolName: input.tool_name,
          toolName: normalizeSclawToolName(input.tool_name),
          toolKind: claudeToolKind(input.tool_name),
          toolCallId: input.tool_use_id,
          input: toolInput,
          result: input.tool_response,
          isError: responseIsError(input.tool_response),
        }, context);
      } finally {
        stateManager.completeToolCall(context.sessionKey, input.tool_use_id);
      }
      return {};
    };
    hooks.PostToolUse = [{ hooks: [callback] }];
  }
  return hooks;
}

function missingCapabilityDiagnostic(
  extensionId: string,
  capabilityId: string,
): SclawExtensionDiagnostic {
  return {
    extensionId,
    contributionId: capabilityId,
    code: 'MISSING_CAPABILITY',
    message: `Required capability is unavailable: ${capabilityId}`,
  };
}

export async function buildClaudeAgentExtensions(
  input: BuildClaudeAgentExtensionsInput,
): Promise<BuildClaudeAgentExtensionsResult> {
  const entries = input.entries ?? CLAUDE_AGENT_EXTENSIONS;
  const capabilities = input.capabilities ?? sclawAgentExtensionCapabilities;
  const stateManager = input.stateManager ?? sclawAgentExtensionState;
  const extensionLogger = input.logger ?? sclawAgentExtensionLogger;
  const diagnostics = validateAgentExtensionRegistry(entries);
  const options: ClaudeRuntimeOptions = {};
  const usedExtensionIds = new Set<string>();
  const usedToolNames = new Set<string>();
  const usedMcpServers = new Set<string>();
  const buildStartedAt = Date.now();

  extensionLogger.info('[agent-extension] build.start', {
    engine: 'claude',
    sessionKey: input.sessionKey,
    mode: input.mode,
    registryEntries: entries.length,
  });
  for (const diagnostic of diagnostics) {
    extensionLogger.warn('[agent-extension] registry.diagnostic', {
      engine: 'claude',
      ...diagnostic,
    });
  }

  stateManager.beginTurn(input.sessionKey);

  for (const entry of entries) {
    const definition = entry.common;
    if (
      usedExtensionIds.has(definition.id)
      || !supportsEngine(definition, 'claude')
      || !isValidAgentExtensionId(definition.id)
    ) continue;
    usedExtensionIds.add(definition.id);
    extensionLogger.debug('[agent-extension] extension.build.start', {
      engine: 'claude',
      extensionId: definition.id,
      mode: input.mode,
      commandShell: input.commandShell ?? 'bash',
    });

    const missingCapability = definition.requiredCapabilities?.find((token) => !capabilities.has(token));
    if (missingCapability) {
      diagnostics.push(missingCapabilityDiagnostic(definition.id, missingCapability.id));
      extensionLogger.warn('[agent-extension] extension.skipped', {
        engine: 'claude',
        extensionId: definition.id,
        reason: 'missing-capability',
        capabilityId: missingCapability.id,
      });
      continue;
    }

    const context: SclawExtensionBuildContext = {
      engine: 'claude',
      sessionKey: input.sessionKey,
      mode: input.mode,
      commandShell: input.commandShell ?? 'bash',
      userPrompt: input.userPrompt,
      cwd: input.cwd,
      agentId: input.agentId,
      model: input.model,
      accountId: input.accountId,
      runId: input.runId,
      capabilities,
      state: stateManager.forExtension(input.sessionKey, definition.id),
      logger: extensionLogger,
    };
    const native = entry.native?.claude;
    const replaceCommon = native?.mode === 'replace';

    if (!replaceCommon) {
      const evaluateActivation = createSclawActivationEvaluator({
        extensionId: definition.id,
        activations: definition.activations,
        context,
        diagnostics,
      });
      const sdkTools = [];
      for (const toolDefinition of definition.tools ?? []) {
        if (
          !supportsEngine(toolDefinition, 'claude')
          || !supportsSessionMode(toolDefinition, input.mode)
        ) continue;
        const activation = await evaluateActivation(toolDefinition.activation);
        if (!activation.active) {
          extensionLogger.debug('[agent-extension] contribution.skipped', {
            engine: 'claude',
            extensionId: definition.id,
            contributionType: 'tool',
            contributionId: toolDefinition.name,
            activationId: toolDefinition.activation,
            reason: activation.reason ?? activation.source,
          });
          continue;
        }
        if (!isValidAgentExtensionResourceName(toolDefinition.name)) continue;
        const normalizedName = toolDefinition.name.trim().toLowerCase();
        if (usedToolNames.has(normalizedName)) continue;
        try {
          const shape = typeBoxObjectToZodRawShape(toolDefinition.parameters);
          sdkTools.push(createClaudeTool(
            toolDefinition.name,
            toolDefinition.description,
            shape,
            async (params, extra): Promise<CallToolResult> => {
              const toolCallId = resolveToolCallId(extra, definition.id);
              const startedAt = Date.now();
              let outcome: SclawToolOutcome;
              extensionLogger.debug('[agent-extension] tool.execute.start', {
                engine: 'claude',
                extensionId: definition.id,
                toolName: toolDefinition.name,
                toolCallId,
              });
              try {
                outcome = await toolDefinition.execute(params, {
                  ...context,
                  toolCallId,
                });
              } catch (error) {
                extensionLogger.error('[agent-extension] tool.execute.failed', {
                  engine: 'claude',
                  extensionId: definition.id,
                  toolName: toolDefinition.name,
                  toolCallId,
                  error: error instanceof Error ? error.message : String(error),
                });
                outcome = sclawToolFailure(
                  definition.id,
                  'extension_tool_failed',
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                // MCP callback metadata does not always expose Claude's hook tool_use_id.
                // Clear the execution scope here; policy scopes are cleared by PostToolUse.
                stateManager.completeToolCall(context.sessionKey, toolCallId);
              }
              extensionLogger.info('[agent-extension] tool.execute.completed', {
                engine: 'claude',
                extensionId: definition.id,
                toolName: toolDefinition.name,
                toolCallId,
                success: outcome.success,
                errorCode: outcome.success ? undefined : outcome.error.code,
                durationMs: Date.now() - startedAt,
              });
              return outcomeResult(outcome);
            },
          ));
          usedToolNames.add(normalizedName);
          extensionLogger.debug('[agent-extension] tool.registered', {
            engine: 'claude',
            extensionId: definition.id,
            toolName: toolDefinition.name,
          });
        } catch (error) {
          diagnostics.push({
            extensionId: definition.id,
            contributionId: toolDefinition.name,
            code: 'UNSUPPORTED_TOOL_SCHEMA',
            message: error instanceof Error ? error.message : String(error),
          });
          extensionLogger.warn('[agent-extension] tool.skipped', {
            engine: 'claude',
            extensionId: definition.id,
            toolName: toolDefinition.name,
            reason: 'unsupported-schema',
          });
        }
      }
      if (sdkTools.length > 0) {
        options.mcpServers ??= {};
        options.mcpServers[definition.id] = createSdkMcpServer({
          name: definition.id,
          version: definition.version,
          tools: sdkTools,
        });
        usedMcpServers.add(definition.id);
      }

      const policies = (definition.policies ?? []).filter(
        (item) => supportsEngine(item, 'claude') && supportsSessionMode(item, input.mode),
      );
      if (policies.length > 0) mergeOptions(options, { hooks: policyHooks(definition.id, policies, context, stateManager) });
      const prompts = [];
      for (const promptContribution of definition.prompts ?? []) {
        if (
          !supportsEngine(promptContribution, 'claude')
          || !supportsSessionMode(promptContribution, input.mode)
        ) continue;
        const activation = await evaluateActivation(promptContribution.activation);
        if (activation.active) prompts.push(promptContribution);
        else {
          extensionLogger.debug('[agent-extension] contribution.skipped', {
            engine: 'claude',
            extensionId: definition.id,
            contributionType: 'prompt',
            contributionId: promptContribution.id,
            activationId: promptContribution.activation,
            reason: activation.reason ?? activation.source,
          });
        }
      }
      const prompt = await buildSclawPrompt(definition.id, prompts, context, diagnostics);
      if (prompt) mergeOptions(options, { systemPromptAppend: prompt });
    }

    if (!native) continue;
    if (
      native.claims?.tools?.some((name) => !isValidAgentExtensionResourceName(name))
      || native.claims?.mcpServers?.some((name) => !isValidAgentExtensionResourceName(name))
    ) continue;
    const claimedToolCollision = native.claims?.tools?.find(
      (name) => usedToolNames.has(name.trim().toLowerCase()),
    );
    const claimedServerCollision = native.claims?.mcpServers?.find((name) => usedMcpServers.has(name));
    if (claimedToolCollision || claimedServerCollision) {
      diagnostics.push({
        extensionId: definition.id,
        contributionId: claimedToolCollision ?? claimedServerCollision,
        code: 'NATIVE_CONTRIBUTION_COLLISION',
        message: `Claude native contribution collides with ${claimedToolCollision ?? claimedServerCollision}`,
      });
      extensionLogger.warn('[agent-extension] native.skipped', {
        engine: 'claude',
        extensionId: definition.id,
        reason: 'resource-collision',
        resourceName: claimedToolCollision ?? claimedServerCollision,
      });
      continue;
    }
    try {
      const nativeStartedAt = Date.now();
      extensionLogger.debug('[agent-extension] native.build.start', {
        engine: 'claude',
        extensionId: definition.id,
        mode: native.mode ?? 'augment',
      });
      const built = await native.build(context);
      const actualServerCollision = Object.keys(built.mcpServers ?? {}).find(
        (name) => usedMcpServers.has(name),
      );
      if (actualServerCollision) {
        diagnostics.push({
          extensionId: definition.id,
          contributionId: actualServerCollision,
          code: 'NATIVE_CONTRIBUTION_COLLISION',
          message: `Claude native MCP server collides with ${actualServerCollision}`,
        });
        extensionLogger.warn('[agent-extension] native.skipped', {
          engine: 'claude',
          extensionId: definition.id,
          reason: 'resource-collision',
          resourceName: actualServerCollision,
        });
        continue;
      }
      mergeOptions(options, built);
      for (const name of native.claims?.tools ?? []) usedToolNames.add(name.trim().toLowerCase());
      for (const name of Object.keys(built.mcpServers ?? {})) usedMcpServers.add(name);
      extensionLogger.info('[agent-extension] native.build.completed', {
        engine: 'claude',
        extensionId: definition.id,
        mode: native.mode ?? 'augment',
        mcpServers: Object.keys(built.mcpServers ?? {}),
        hookEvents: Object.keys(built.hooks ?? {}),
        hasPrompt: Boolean(built.systemPromptAppend?.trim()),
        durationMs: Date.now() - nativeStartedAt,
      });
    } catch (error) {
      diagnostics.push({
        extensionId: definition.id,
        code: 'NATIVE_CONTRIBUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      extensionLogger.error('[agent-extension] native.build.failed', {
        engine: 'claude',
        extensionId: definition.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  extensionLogger.info('[agent-extension] build.completed', {
    engine: 'claude',
    sessionKey: input.sessionKey,
    mode: input.mode,
    extensionsBuilt: usedExtensionIds.size,
    tools: usedToolNames.size,
    mcpServers: usedMcpServers.size,
    diagnostics: diagnostics.length,
    durationMs: Date.now() - buildStartedAt,
  });
  return { options, diagnostics };
}
