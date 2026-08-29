import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  SclawToolExecutionError,
  buildSclawPrompt,
  normalizeSclawToolName,
  runSclawAfterToolPolicies,
  runSclawBeforeToolPolicies,
  sclawToolFailure,
  supportsEngine,
  type SclawAgentSessionMode,
  type SclawCapabilityResolver,
  type SclawExtensionBuildContext,
  type SclawExtensionDiagnostic,
  type SclawExtensionLogger,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import {
  SCLAW_AGENT_EXTENSIONS,
  isValidAgentExtensionId,
  isValidAgentExtensionResourceName,
  validateAgentExtensionRegistry,
  type RegisteredAgentExtension,
} from '../../registry';

const defaultCapabilities = new SclawCapabilityRegistry();
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
  cwd?: string;
  allowedRoots?: readonly string[];
  agentId?: string;
  runId?: string;
  entries?: readonly RegisteredAgentExtension[];
  capabilities?: SclawCapabilityResolver;
  stateManager?: SclawExtensionStateManager;
  logger?: SclawExtensionLogger;
}

export interface BuildPiAgentExtensionsResult {
  extensions: InlineExtension[];
  diagnostics: SclawExtensionDiagnostic[];
}

function replaceInput(target: Record<string, unknown>, replacement: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

function resultIsError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).isError);
}

function normalizeNativeExtensions(value: InlineExtension | readonly InlineExtension[]): InlineExtension[] {
  return Array.isArray(value) ? [...value] : [value as InlineExtension];
}

export async function buildPiAgentExtensions(
  input: BuildPiAgentExtensionsInput,
): Promise<BuildPiAgentExtensionsResult> {
  const entries = input.entries ?? SCLAW_AGENT_EXTENSIONS;
  const capabilities = input.capabilities ?? defaultCapabilities;
  const stateManager = input.stateManager ?? defaultStateManager;
  const extensionLogger = input.logger ?? defaultLogger;
  const diagnostics = validateAgentExtensionRegistry(entries);
  const extensions: InlineExtension[] = [];
  const usedExtensionIds = new Set<string>();
  const usedToolNames = new Set<string>();

  for (const entry of entries) {
    const definition = entry.common;
    if (
      usedExtensionIds.has(definition.id)
      || !supportsEngine(definition, 'pi')
      || !isValidAgentExtensionId(definition.id)
    ) continue;
    usedExtensionIds.add(definition.id);
    const missingCapability = definition.requiredCapabilities?.find((token) => !capabilities.has(token));
    if (missingCapability) {
      diagnostics.push({
        extensionId: definition.id,
        contributionId: missingCapability.id,
        code: 'MISSING_CAPABILITY',
        message: `Required capability is unavailable: ${missingCapability.id}`,
      });
      continue;
    }

    const contextFor = (userPrompt?: string): SclawExtensionBuildContext => ({
      engine: 'pi',
      sessionKey: input.sessionKey,
      mode: input.mode,
      userPrompt,
      cwd: input.cwd,
      allowedRoots: input.allowedRoots,
      agentId: input.agentId,
      runId: input.runId,
      capabilities,
      state: stateManager.forExtension(input.sessionKey, definition.id),
      logger: extensionLogger,
    });
    const native = entry.native?.pi;
    const replaceCommon = native?.mode === 'replace';

    if (!replaceCommon) {
      const tools: SclawToolDefinition[] = [];
      for (const tool of (definition.tools ?? []).filter((item) => supportsEngine(item, 'pi'))) {
        if (!isValidAgentExtensionResourceName(tool.name)) continue;
        const normalizedName = tool.name.trim().toLowerCase();
        if (usedToolNames.has(normalizedName)) continue;
        tools.push(tool);
        usedToolNames.add(normalizedName);
      }
      const policies = (definition.policies ?? []).filter((item) => supportsEngine(item, 'pi'));
      const prompts = (definition.prompts ?? []).filter((item) => supportsEngine(item, 'pi'));

      extensions.push({
        name: definition.id,
        factory(pi) {
          for (const toolDefinition of tools) {
            pi.registerTool({
              name: toolDefinition.name,
              label: toolDefinition.label,
              description: toolDefinition.description,
              parameters: toolDefinition.parameters,
              async execute(toolCallId, params, signal) {
                let outcome: SclawToolOutcome;
                try {
                  outcome = await toolDefinition.execute(params, {
                    ...contextFor(),
                    toolCallId,
                    signal,
                  });
                } catch (error) {
                  outcome = sclawToolFailure(
                    definition.id,
                    'extension_tool_failed',
                    error instanceof Error ? error.message : String(error),
                  );
                }
                if (!outcome.success) throw new SclawToolExecutionError(outcome);
                return {
                  content: [{ type: 'text', text: JSON.stringify(outcome) }],
                  details: outcome,
                };
              },
            });
          }

          if (policies.some((policy) => policy.beforeTool)) {
            pi.on('tool_call', async (event) => {
              const inputRecord = event.input as Record<string, unknown>;
              const decision = await runSclawBeforeToolPolicies(definition.id, policies, {
                rawToolName: event.toolName,
                toolName: normalizeSclawToolName(event.toolName),
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
          if (prompts.length > 0) {
            pi.on('before_agent_start', async (event) => {
              const prompt = await buildSclawPrompt(
                definition.id,
                prompts,
                contextFor(event.prompt),
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
      continue;
    }
    try {
      extensions.push(...normalizeNativeExtensions(await native.build(contextFor())));
      for (const name of native.claims?.tools ?? []) usedToolNames.add(name.trim().toLowerCase());
    } catch (error) {
      diagnostics.push({
        extensionId: definition.id,
        code: 'NATIVE_CONTRIBUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (extensions.length > 0) {
    extensions.unshift({
      name: 'sclaw-extension-lifecycle',
      hidden: true,
      factory(pi) {
        pi.on('turn_start', () => stateManager.beginTurn(input.sessionKey));
        pi.on('turn_end', () => stateManager.endTurn(input.sessionKey));
        pi.on('session_shutdown', () => stateManager.clearSession(input.sessionKey));
      },
    });
  }

  return { extensions, diagnostics };
}
