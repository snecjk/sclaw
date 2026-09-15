import type { HookCallbackMatcher, HookEvent, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { RETIRED_SKILLS_SYSTEM_PROMPT } from '../../shared/retired-skills';
import { buildWorkspaceArtifactOutputRule } from '../../shared/workspace-paths';
import { isScheduledTaskExecutionSessionKey } from '../../shared/scheduled-task-instruction';
import {
  buildStoAgentTelemetryClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-agent-telemetry/sdk';
import { logger } from '../utils/logger';
import { getAgentCurrentUserContextPrompt } from '../services/agent-current-user-context';
import { buildConnectedConnectorsAgentPrompt } from '../connectors/agent-context';
import { buildConnectorBashGateHooks } from '../connectors/claude-binary-gate';
import { buildClaudeLoopGuardHooks } from './claude-loop-guard';
import { buildClaudeAgentExtensions } from '../agent-extensions/adapters/claude';

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

interface ClaudeRuntimeExtensionContext {
  sessionKey: string;
  runId?: string;
  agentId?: string;
  cwd?: string;
  /** 本轮用户原文；用于口头「发给某人」等按需注入启发式。 */
  userPrompt?: string;
}

interface ClaudeRuntimeExtension {
  id: string;
  build(context: ClaudeRuntimeExtensionContext): Promise<ClaudeRuntimeOptions> | ClaudeRuntimeOptions;
}

function mergeHooks(
  target: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  source: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
): void {
  if (!source) return;

  for (const [eventName, matchers] of Object.entries(source) as Array<[HookEvent, HookCallbackMatcher[] | undefined]>) {
    if (!matchers?.length) continue;
    target[eventName] = [...(target[eventName] ?? []), ...matchers];
  }
}

function mergeRuntimeOptions(target: ClaudeRuntimeOptions, source: ClaudeRuntimeOptions): void {
  if (source.hooks) {
    target.hooks ??= {};
    mergeHooks(target.hooks, source.hooks);
  }

  if (source.systemPromptAppend?.trim()) {
    target.systemPromptAppend = [target.systemPromptAppend, source.systemPromptAppend.trim()]
      .filter(Boolean)
      .join('\n\n');
  }

  if (source.mcpServers) {
    target.mcpServers = {
      ...(target.mcpServers ?? {}),
      ...source.mcpServers,
    };
  }
}

const agentTelemetryExtension: ClaudeRuntimeExtension = {
  id: 'sto-agent-telemetry',
  build: ({ sessionKey }) => buildStoAgentTelemetryClaudeRuntimeOptions(sessionKey),
};

const ssoUserContextExtension: ClaudeRuntimeExtension = {
  id: 'sto-sso-user-context',
  async build({ sessionKey }) {
    const blocks: string[] = [RETIRED_SKILLS_SYSTEM_PROMPT];

    let workspaceAbsolutePath: string | null = null;
    try {
      const { resolveSessionToolCwd } = await import('../services/session-catalog-service');
      const { extractAgentIdFromSessionKey } = await import('../../shared/session-agent-id');
      const agentId = extractAgentIdFromSessionKey(sessionKey) ?? undefined;
      workspaceAbsolutePath = await resolveSessionToolCwd(sessionKey, agentId, 'claude');
    } catch (err) {
      logger.warn(`[claude-sso-context] failed to resolve workspace cwd (${String(err)})`);
    }

    blocks.push([
      '产物文件引用规范（重要）：',
      buildWorkspaceArtifactOutputRule(undefined, { workspaceAbsolutePath }),
    ].join('\n'));

    const currentUserContext = await getAgentCurrentUserContextPrompt();
    if (currentUserContext) blocks.push(currentUserContext);

    return {
      systemPromptAppend: blocks.join('\n\n'),
    };
  },
};

const connectorBashGateExtension: ClaudeRuntimeExtension = {
  id: 'sto-connectors-bash-gate',
  build() {
    return { hooks: buildConnectorBashGateHooks() };
  },
};

const connectorsContextExtension: ClaudeRuntimeExtension = {
  id: 'sto-connectors-context',
  build() {
    const prompt = buildConnectedConnectorsAgentPrompt();
    return prompt ? { systemPromptAppend: prompt } : {};
  },
};

/** 空转防护：无条件启用，是所有会话的安全网而不是某个域的能力。 */
const loopGuardExtension: ClaudeRuntimeExtension = {
  id: 'sto-loop-guard',
  build({ sessionKey }) {
    return { hooks: buildClaudeLoopGuardHooks(sessionKey) };
  },
};

const claudeRuntimeExtensions: ClaudeRuntimeExtension[] = [
  loopGuardExtension,
  connectorBashGateExtension,
  agentTelemetryExtension,
  ssoUserContextExtension,
  connectorsContextExtension,
];

export async function buildClaudeRuntimeOptions(
  sessionKey: string,
  userPrompt?: string,
  turn?: { runId?: string; agentId?: string; cwd?: string },
): Promise<ClaudeRuntimeOptions> {
  logger.info(`[claude-runtime] building runtime options, sessionKey=${sessionKey}, extensions=${claudeRuntimeExtensions.length} [${claudeRuntimeExtensions.map(e => e.id).join(', ')}]`);

  const options: ClaudeRuntimeOptions = {};
  const context: ClaudeRuntimeExtensionContext = { sessionKey, userPrompt, ...turn };

  for (const extension of claudeRuntimeExtensions) {
    const start = Date.now();
    try {
      logger.info(`[claude-runtime] building extension: ${extension.id}`);
      const built = await extension.build(context);
      mergeRuntimeOptions(options, built);
      logger.info(`[claude-runtime] extension ${extension.id} built successfully in ${Date.now() - start}ms`);
    } catch (error) {
      logger.warn(`[claude-runtime] extension ${extension.id} failed to build after ${Date.now() - start}ms`, error);
    }
  }

  const unified = await buildClaudeAgentExtensions({
    sessionKey,
    userPrompt,
    runId: turn?.runId,
    agentId: turn?.agentId,
    cwd: turn?.cwd,
    mode: isScheduledTaskExecutionSessionKey(sessionKey) ? 'scheduled' : 'interactive',
  });
  mergeRuntimeOptions(options, unified.options);
  for (const diagnostic of unified.diagnostics) {
    logger.warn('[claude-runtime] unified extension diagnostic', diagnostic);
  }

  const result: ClaudeRuntimeOptions = {
    hooks: options.hooks && Object.keys(options.hooks).length > 0 ? options.hooks : undefined,
    systemPromptAppend: options.systemPromptAppend,
    mcpServers: options.mcpServers && Object.keys(options.mcpServers).length > 0 ? options.mcpServers : undefined,
  };

  logger.info(
    `[claude-runtime] build complete — hooks: ${result.hooks ? Object.keys(result.hooks).join(',') : 'none'}, ` +
    `systemPromptAppend: ${result.systemPromptAppend ? `${result.systemPromptAppend.length} chars` : 'none'}, ` +
    `mcpServers: ${result.mcpServers ? Object.keys(result.mcpServers).join(',') : 'none'}`,
  );

  return result;
}
