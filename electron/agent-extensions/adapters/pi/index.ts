import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  SclawToolExecutionError,
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
  type SclawToolDefinition,
  type SclawToolOutcome,
  type SclawToolKind,
} from '../../../../shared/agent-extensions';
import {
  isValidAgentExtensionId,
  isValidAgentExtensionResourceName,
  validateAgentExtensionRegistry,
  type RegisteredAgentExtension,
} from '../../registry';
import { PI_AGENT_EXTENSIONS } from './registry';
import { STO_SCHEDULED_TASK_CAPABILITY } from '../../extensions/sto-scheduled-task-tool/capability';
import { createHostApiScheduledTaskPort } from '../../extensions/sto-scheduled-task-tool/host-api-capability';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from '../../extensions/sto-dingtalk-send-guard/capability';
import { createHostApiDingTalkSendGuardPort } from '../../extensions/sto-dingtalk-send-guard/host-api-capability';
import { STO_SKILL_RUNTIME_CAPABILITY } from '../../extensions/sto-skill-runtime/capability';
import { createHostApiSkillRuntimePort } from '../../extensions/sto-skill-runtime/host-api-capability';
import {
  beginRuntimeSkillAccessTurn,
  clearRuntimeSkillAccess,
} from '../../extensions/sto-skill-runtime/access';

const defaultCapabilities = new SclawCapabilityRegistry()
  .provide(STO_SCHEDULED_TASK_CAPABILITY, createHostApiScheduledTaskPort())
  .provide(STO_DINGTALK_SEND_GUARD_CAPABILITY, createHostApiDingTalkSendGuardPort())
  .provide(STO_SKILL_RUNTIME_CAPABILITY, createHostApiSkillRuntimePort());
const defaultStateManager = new SclawExtensionStateManager();
const defaultLogger: SclawExtensionLogger = {
  debug: (message, details) => console.debug(message, details ?? ''),
  info: (message, details) => console.info(message, details ?? ''),
  warn: (message, details) => console.warn(message, details ?? ''),
  error: (message, details) => console.error(message, details ?? ''),
};

export interface BuildPiAgentExtensionsInput {
  sessionKey: string;
  mode: SclawAgentSessionMode;
  commandShell?: SclawCommandShell;
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

export interface BuildPiAgentExtensionsResult {
  extensions: InlineExtension[];
  /** Exact extension tool names that are active before lazy activation. */
  initiallyActiveToolNames: string[];
  diagnostics: SclawExtensionDiagnostic[];
  setTurnContext(context: { runId?: string }): void;
  /** Clears framework-owned session/turn/tool-call state on worker disposal. */
  clearSessionState(): void;
}

function replaceInput(target: Record<string, unknown>, replacement: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

function resultIsError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).isError);
}

function piToolKind(toolName: string): SclawToolKind {
  const normalized = normalizeSclawToolName(toolName);
  if (normalized === 'bash' || normalized === 'powershell') return 'shell';
  if (['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(normalized)) return 'filesystem';
  return 'other';
}

function normalizeNativeExtensions(value: InlineExtension | readonly InlineExtension[]): InlineExtension[] {
  return Array.isArray(value) ? [...value] : [value as InlineExtension];
}

export async function buildPiAgentExtensions(
  input: BuildPiAgentExtensionsInput,
): Promise<BuildPiAgentExtensionsResult> {
  const entries = input.entries ?? PI_AGENT_EXTENSIONS;
  const capabilities = input.capabilities ?? defaultCapabilities;
  const stateManager = input.stateManager ?? defaultStateManager;
  const extensionLogger = input.logger ?? defaultLogger;
  const diagnostics = validateAgentExtensionRegistry(entries);
  const extensions: InlineExtension[] = [];
  const usedExtensionIds = new Set<string>();
  const usedToolNames = new Set<string>();
  const initiallyActiveToolNames: string[] = [];
  const buildStartedAt = Date.now();
  let turnContext: { runId?: string } = {};

  extensionLogger.info('[agent-extension] build.start', {
    engine: 'pi',
    sessionKey: input.sessionKey,
    mode: input.mode,
    registryEntries: entries.length,
  });
  for (const diagnostic of diagnostics) {
    extensionLogger.warn('[agent-extension] registry.diagnostic', {
      engine: 'pi',
      ...diagnostic,
    });
  }

  for (const entry of entries) {
    const definition = entry.common;
    if (
      usedExtensionIds.has(definition.id)
      || !supportsEngine(definition, 'pi')
      || !supportsSessionMode(definition, input.mode)
      || !isValidAgentExtensionId(definition.id)
    ) continue;
    usedExtensionIds.add(definition.id);
    // extensionLogger.debug('[agent-extension] extension.build.start', {
    //   engine: 'pi',
    //   extensionId: definition.id,
    //   mode: input.mode,
    // });
    const missingCapability = definition.requiredCapabilities?.find((token) => !capabilities.has(token));
    if (missingCapability) {
      diagnostics.push({
        extensionId: definition.id,
        contributionId: missingCapability.id,
        code: 'MISSING_CAPABILITY',
        message: `Required capability is unavailable: ${missingCapability.id}`,
      });
      extensionLogger.warn('[agent-extension] extension.skipped', {
        engine: 'pi',
        extensionId: definition.id,
        reason: 'missing-capability',
        capabilityId: missingCapability.id,
      });
      continue;
    }

    const contextFor = (userPrompt?: string): SclawExtensionBuildContext => ({
      engine: 'pi',
      sessionKey: input.sessionKey,
      mode: input.mode,
      commandShell: input.commandShell ?? (process.platform === 'win32' ? 'powershell' : 'bash'),
      userPrompt,
      cwd: input.cwd,
      agentId: input.agentId,
      model: input.model,
      accountId: input.accountId,
      runId: turnContext.runId ?? input.runId,
      capabilities,
      state: stateManager.forExtension(input.sessionKey, definition.id),
      logger: extensionLogger,
    });
    const native = entry.native?.pi;
    const replaceCommon = native?.mode === 'replace';

    if (!replaceCommon) {
      const tools: SclawToolDefinition[] = [];
      for (const tool of (definition.tools ?? []).filter(
        (item) => supportsEngine(item, 'pi') && supportsSessionMode(item, input.mode),
      )) {
        if (!isValidAgentExtensionResourceName(tool.name)) continue;
        const normalizedName = tool.name.trim().toLowerCase();
        if (usedToolNames.has(normalizedName)) continue;
        tools.push(tool);
        usedToolNames.add(normalizedName);
        if (!tool.activation) initiallyActiveToolNames.push(tool.name);
      }
      const policies = (definition.policies ?? []).filter(
        (item) => supportsEngine(item, 'pi') && supportsSessionMode(item, input.mode),
      );
      const prompts = (definition.prompts ?? []).filter(
        (item) => supportsEngine(item, 'pi') && supportsSessionMode(item, input.mode),
      );

      extensions.push({
        name: definition.id,
        factory(pi) {
          extensionLogger.info('[agent-extension] extension.activated', {
            engine: 'pi',
            extensionId: definition.id,
            tools: tools.length,
            policies: policies.length,
            prompts: prompts.length,
          });
          for (const toolDefinition of tools) {
            pi.registerTool({
              name: toolDefinition.name,
              label: toolDefinition.label,
              description: toolDefinition.description,
              parameters: toolDefinition.parameters,
              async execute(toolCallId, params, signal) {
                const startedAt = Date.now();
                let outcome: SclawToolOutcome;
                extensionLogger.debug('[agent-extension] tool.execute.start', {
                  engine: 'pi',
                  extensionId: definition.id,
                  toolName: toolDefinition.name,
                  toolCallId,
                });
                try {
                  outcome = await toolDefinition.execute(params, {
                    ...contextFor(),
                    toolCallId,
                    signal,
                  });
                } catch (error) {
                  extensionLogger.error('[agent-extension] tool.execute.failed', {
                    engine: 'pi',
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
                }
                extensionLogger.info('[agent-extension] tool.execute.completed', {
                  engine: 'pi',
                  extensionId: definition.id,
                  toolName: toolDefinition.name,
                  toolCallId,
                  success: outcome.success,
                  errorCode: outcome.success ? undefined : outcome.error.code,
                  durationMs: Date.now() - startedAt,
                });
                if (!outcome.success) throw new SclawToolExecutionError(outcome);
                return {
                  content: [{ type: 'text', text: JSON.stringify(outcome) }],
                  details: outcome,
                };
              },
            });
            extensionLogger.debug('[agent-extension] tool.registered', {
              engine: 'pi',
              extensionId: definition.id,
              toolName: toolDefinition.name,
            });
          }

          if (policies.some((policy) => policy.beforeTool)) {
            pi.on('tool_call', async (event) => {
              const inputRecord = event.input as Record<string, unknown>;
              const decision = await runSclawBeforeToolPolicies(definition.id, policies, {
                rawToolName: event.toolName,
                toolName: normalizeSclawToolName(event.toolName),
                toolKind: piToolKind(event.toolName),
                toolCallId: event.toolCallId,
                input: inputRecord,
              }, contextFor());
              if (decision.action === 'deny') {
                return { block: true, reason: decision.reason, terminate: decision.terminate };
              }
              if (decision.action === 'patch') replaceInput(inputRecord, decision.input);
              return undefined;
            });
          }
          if (tools.length > 0 || policies.length > 0) {
            pi.on('tool_result', async (event) => {
              try {
                await runSclawAfterToolPolicies(definition.id, policies, {
                  rawToolName: event.toolName,
                  toolName: normalizeSclawToolName(event.toolName),
                  toolKind: piToolKind(event.toolName),
                  toolCallId: event.toolCallId,
                  input: event.input,
                  content: event.content,
                  details: event.details,
                  result: event,
                  isError: event.isError || resultIsError(event),
                }, contextFor());
              } finally {
                stateManager.completeToolCall(input.sessionKey, event.toolCallId);
              }
            });
          }
          if (prompts.length > 0 || tools.some((tool) => Boolean(tool.activation))) {
            pi.on('before_agent_start', async (event) => {
              const context = contextFor(event.prompt);
              const evaluateActivation = createSclawActivationEvaluator({
                extensionId: definition.id,
                activations: definition.activations,
                context,
                diagnostics,
              });
              const toolsToActivate: string[] = [];
              for (const toolDefinition of tools) {
                if (
                  toolDefinition.activation
                  && (await evaluateActivation(toolDefinition.activation)).active
                ) {
                  toolsToActivate.push(toolDefinition.name);
                }
              }
              if (toolsToActivate.length > 0) {
                const activeTools = pi.getActiveTools();
                const nextActiveTools = [...new Set([...activeTools, ...toolsToActivate])];
                if (nextActiveTools.length !== activeTools.length) {
                  pi.setActiveTools(nextActiveTools);
                  extensionLogger.info('[agent-extension] tools.activated', {
                    engine: 'pi',
                    extensionId: definition.id,
                    activationToolCount: toolsToActivate.length,
                    activeToolCount: nextActiveTools.length,
                  });
                }
              }
              const activePrompts = [];
              for (const promptContribution of prompts) {
                if ((await evaluateActivation(promptContribution.activation)).active) {
                  activePrompts.push(promptContribution);
                }
              }
              const prompt = await buildSclawPrompt(
                definition.id,
                activePrompts,
                context,
                diagnostics,
              );
              return prompt ? { systemPrompt: `${event.systemPrompt}\n\n${prompt}` } : undefined;
            });
          }
        },
      });
    }

    if (!native) continue;
    if (native.claims?.tools?.some((name) => !isValidAgentExtensionResourceName(name))) continue;
    const collision = native.claims?.tools?.find(
      (name) => usedToolNames.has(name.trim().toLowerCase()),
    );
    if (collision) {
      diagnostics.push({
        extensionId: definition.id,
        contributionId: collision,
        code: 'NATIVE_CONTRIBUTION_COLLISION',
        message: `Pi native contribution collides with ${collision}`,
      });
      extensionLogger.warn('[agent-extension] native.skipped', {
        engine: 'pi',
        extensionId: definition.id,
        reason: 'resource-collision',
        resourceName: collision,
      });
      continue;
    }
    try {
      // const nativeStartedAt = Date.now();
      // extensionLogger.debug('[agent-extension] native.build.start', {
      //   engine: 'pi',
      //   extensionId: definition.id,
      //   mode: native.mode ?? 'augment',
      // });
      const nativeExtensions = normalizeNativeExtensions(await native.build(contextFor()));
      extensions.push(...nativeExtensions);
      for (const name of native.claims?.tools ?? []) {
        usedToolNames.add(name.trim().toLowerCase());
        initiallyActiveToolNames.push(name);
      }
      // extensionLogger.info('[agent-extension] native.build.completed', {
      //   engine: 'pi',
      //   extensionId: definition.id,
      //   mode: native.mode ?? 'augment',
      //   inlineExtensions: nativeExtensions.map((extension) => (
      //     typeof extension === 'function' ? 'anonymous' : extension.name
      //   )),
      //   durationMs: Date.now() - nativeStartedAt,
      // });
    } catch (error) {
      diagnostics.push({
        extensionId: definition.id,
        code: 'NATIVE_CONTRIBUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      extensionLogger.error('[agent-extension] native.build.failed', {
        engine: 'pi',
        extensionId: definition.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (extensions.length > 0) {
    extensions.unshift({
      name: 'sclaw-extension-lifecycle',
      hidden: true,
      factory(pi) {
        pi.on('turn_start', () => stateManager.beginTurn(input.sessionKey));
        pi.on('turn_end', () => {
          stateManager.endTurn(input.sessionKey);
          turnContext = {};
          clearRuntimeSkillAccess(input.sessionKey);
        });
        pi.on('session_shutdown', (event) => {
          // Pi tears down and recreates its extension runtime on every resource
          // reload. That is not the end of the SClaw conversation, so keep
          // session-scoped activation/state across reloads and only clear it
          // when Pi is actually leaving or replacing the session.
          if (event.reason !== 'reload') stateManager.clearSession(input.sessionKey);
        });
      },
    });
  }

  extensionLogger.info('[agent-extension] build.completed', {
    engine: 'pi',
    sessionKey: input.sessionKey,
    mode: input.mode,
    extensionsBuilt: usedExtensionIds.size,
    inlineExtensions: extensions.length,
    tools: usedToolNames.size,
    diagnostics: diagnostics.length,
    durationMs: Date.now() - buildStartedAt,
  });
  return {
    extensions,
    initiallyActiveToolNames,
    diagnostics,
    setTurnContext: (context) => {
      turnContext = { ...context };
      beginRuntimeSkillAccessTurn(input.sessionKey, context.runId);
    },
    clearSessionState: () => {
      clearRuntimeSkillAccess(input.sessionKey);
      stateManager.clearSession(input.sessionKey);
    },
  };
}
