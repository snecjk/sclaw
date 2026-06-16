import type { HookCallbackMatcher, HookEvent, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import {
  buildStoDingTalkSendGuardClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-dingtalk-send-guard/sdk';
import {
  buildWorkflowHooks,
  WORKFLOW_SYSTEM_PROMPT,
} from '../../sto-plugin/claude/sto-workflow-tool/hooks';
import { createWorkflowMcpServer } from '../../sto-plugin/claude/sto-workflow-tool/tools';
import {
  buildStoAgentTelemetryClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-agent-telemetry/sdk';
import { getStoToken } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { resolveStoBaseUrl } from '../utils/sto-domain';

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

interface ClaudeRuntimeExtensionContext {
  sessionKey: string;
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

const dingTalkSendGuardExtension: ClaudeRuntimeExtension = {
  id: 'sto-dingtalk-send-guard',
  build: ({ sessionKey }) => buildStoDingTalkSendGuardClaudeRuntimeOptions(sessionKey),
};

const workflowToolExtension: ClaudeRuntimeExtension = {
  id: 'sto-workflow-tool',
  async build() {
    const stoToken = await getStoToken();
    if (!stoToken) {
      logger.warn('[claude-workflow] STO token is unavailable; workflow tools will not be registered');
      return {};
    }

    const baseUrl = await resolveStoBaseUrl();
    logger.info(`[claude-workflow] registering workflow tools baseUrl=${baseUrl}`);

    return {
      hooks: buildWorkflowHooks(),
      systemPromptAppend: WORKFLOW_SYSTEM_PROMPT,
      mcpServers: {
        'sto-workflow-tool': createWorkflowMcpServer({
          baseUrl,
          stoToken,
        }),
      },
    };
  },
};

const agentTelemetryExtension: ClaudeRuntimeExtension = {
  id: 'sto-agent-telemetry',
  build: ({ sessionKey }) => buildStoAgentTelemetryClaudeRuntimeOptions(sessionKey),
};

const claudeRuntimeExtensions: ClaudeRuntimeExtension[] = [
  dingTalkSendGuardExtension,
  workflowToolExtension,
  agentTelemetryExtension,
];

export async function buildClaudeRuntimeOptions(sessionKey: string): Promise<ClaudeRuntimeOptions> {
  logger.info(`[claude-runtime] building runtime options, sessionKey=${sessionKey}, extensions=${claudeRuntimeExtensions.length} [${claudeRuntimeExtensions.map(e => e.id).join(', ')}]`);

  const options: ClaudeRuntimeOptions = {};
  const context: ClaudeRuntimeExtensionContext = { sessionKey };

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
