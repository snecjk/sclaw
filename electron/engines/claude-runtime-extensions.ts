import type { HookCallbackMatcher, HookEvent, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { RETIRED_SKILLS_SYSTEM_PROMPT } from '../../shared/retired-skills';
import { buildWorkspaceArtifactOutputRule } from '../../shared/workspace-paths';
import {
  buildStoBrowserToolClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-browser-tool/sdk';
import {
  buildStoDingTalkSendGuardClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-dingtalk-send-guard/sdk';
import {
  buildWorkflowHooks,
  WORKFLOW_SYSTEM_PROMPT,
} from '../../sto-plugin/claude/sto-workflow-tool/hooks';
import { createWorkflowMcpServer } from '../../sto-plugin/claude/sto-workflow-tool/tools';
import { buildScheduledTaskHooks } from '../../sto-plugin/claude/claude-scheduled-task-tool/hooks';
import {
  CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT,
  createClaudeScheduledTaskMcpServer,
} from '../../sto-plugin/claude/claude-scheduled-task-tool/tools';
import {
  createUserSkillMcpServer,
  USER_SKILL_SYSTEM_PROMPT,
} from '../../sto-plugin/claude/sto-user-skill-tool/tools';
import { buildUserSkillHooks } from '../../sto-plugin/claude/sto-user-skill-tool/hooks';
import {
  isScheduledTaskExecutionSessionKey,
  SCHEDULED_TASK_CORE_PROMPT,
} from '../../shared/scheduled-task-instruction';
import {
  buildStoAgentTelemetryClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-agent-telemetry/sdk';
import { getAuthState, getStoToken } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { PORTS } from '../utils/config';
import { buildConnectedConnectorsAgentPrompt } from '../connectors/agent-context';
import { buildConnectorBashGateHooks } from '../connectors/claude-binary-gate';

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

interface ClaudeRuntimeExtensionContext {
  sessionKey: string;
  /** 本轮用户原文；用于口头「发给某人」等按需注入启发式。 */
  userPrompt?: string;
}

interface ClaudeRuntimeExtension {
  id: string;
  build(context: ClaudeRuntimeExtensionContext): Promise<ClaudeRuntimeOptions> | ClaudeRuntimeOptions;
}

function isAppDevSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:appdev:/.test(sessionKey);
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

const browserToolExtension: ClaudeRuntimeExtension = {
  id: 'sto-browser-tool',
  build({ sessionKey }) {
    if (isAppDevSessionKey(sessionKey)) return {};
    return buildStoBrowserToolClaudeRuntimeOptions({
      sessionKey,
      hostApiPort: PORTS.CLAWX_HOST_API,
    });
  },
};

const dingTalkSendGuardExtension: ClaudeRuntimeExtension = {
  id: 'sto-dingtalk-send-guard',
  build: ({ sessionKey, userPrompt }) =>
    buildStoDingTalkSendGuardClaudeRuntimeOptions(sessionKey, userPrompt),
};

const workflowToolExtension: ClaudeRuntimeExtension = {
  id: 'sto-workflow-tool',
  async build({ sessionKey }) {
    if (isAppDevSessionKey(sessionKey)) return {};
    const stoToken = await getStoToken();
    if (!stoToken) {
      logger.warn('[claude-workflow] STO token is unavailable; workflow tools will not be registered');
      return {};
    }

    const baseUrl = `http://127.0.0.1:${PORTS.CLAWX_HOST_API}`;
    logger.info(`[claude-workflow] registering workflow tools baseUrl=${baseUrl}`);

    return {
      hooks: buildWorkflowHooks(),
      systemPromptAppend: WORKFLOW_SYSTEM_PROMPT,
      mcpServers: {
        'sto-workflow-tool': createWorkflowMcpServer({
          baseUrl,
          stoToken,
          sessionKey,
        }),
      },
    };
  },
};

const scheduledTaskToolExtension: ClaudeRuntimeExtension = {
  id: 'claude-scheduled-task-tool',
  async build({ sessionKey }) {
    if (isAppDevSessionKey(sessionKey)) return {};
    const isExecutionContext = isScheduledTaskExecutionSessionKey(sessionKey);
    if (isExecutionContext) {
      return {
        hooks: buildScheduledTaskHooks(sessionKey),
        // 模块 B：纯执行语义。钉钉格式/必发由执行器 systemPromptAppend 条件注入。
        systemPromptAppend: SCHEDULED_TASK_CORE_PROMPT,
      };
    }

    return {
      hooks: buildScheduledTaskHooks(sessionKey),
      systemPromptAppend: CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT,
      mcpServers: {
        'claude-scheduled-task-tool': createClaudeScheduledTaskMcpServer({
          sessionKey,
        }),
      },
    };
  },
};

const userSkillToolExtension: ClaudeRuntimeExtension = {
  id: 'sto-user-skill-tool',
  build() {
    logger.info('[claude-user-skill] registering save_user_skill MCP + write guard');
    return {
      hooks: buildUserSkillHooks(),
      systemPromptAppend: USER_SKILL_SYSTEM_PROMPT,
      mcpServers: {
        'sto-user-skill-tool': createUserSkillMcpServer(),
      },
    };
  },
};

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
      workspaceAbsolutePath = await resolveSessionToolCwd(sessionKey, agentId);
    } catch (err) {
      logger.warn(`[claude-sso-context] failed to resolve workspace cwd (${String(err)})`);
    }

    blocks.push([
      '产物文件引用规范（重要）：',
      buildWorkspaceArtifactOutputRule(undefined, { workspaceAbsolutePath }),
    ].join('\n'));

    try {
      const auth = await getAuthState();
      const user = auth.user;
      if (user?.userName) {
        const lines: string[] = [];
        lines.push('当前登录用户信息（已认证）：');
        lines.push(`- 用户名：${user.userName}`);
        if (user.realName) lines.push(`- 真实姓名：${user.realName}`);
        if (user.companyCode) lines.push(`- 网点编码（companyCode）：${user.companyCode}`);
        if (user.companyName) lines.push(`- 网点名称（companyName）：${user.companyName}`);
        if (user.departmentCode) lines.push(`- 组织编码（departmentCode）：${user.departmentCode}`);
        if (user.departmentName) lines.push(`- 组织名称（departmentName）：${user.departmentName}`);
        lines.push('');
        lines.push('⚠️ 重要：当调用任何技能、工具或工作流时，如果参数要求提供网点编码（companyCode）或组织编码（departmentCode），而用户没有明确指定其他网点/组织，必须直接使用上述当前登录用户的网点编码和组织编码，禁止向用户询问。不要在对话中要求用户提供这些信息。');
        blocks.push(lines.join('\n'));
        logger.info(`[claude-sso-context] injected SSO user context for ${user.userName}`);
      } else {
        logger.debug('[claude-sso-context] no SSO user found, skipping user context injection');
      }
    } catch (err) {
      logger.warn(`[claude-sso-context] failed to read SSO auth (${String(err)}), skipping user context injection`);
    }

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

const claudeRuntimeExtensions: ClaudeRuntimeExtension[] = [
  connectorBashGateExtension,
  browserToolExtension,
  dingTalkSendGuardExtension,
  workflowToolExtension,
  scheduledTaskToolExtension,
  userSkillToolExtension,
  agentTelemetryExtension,
  ssoUserContextExtension,
  connectorsContextExtension,
];

export async function buildClaudeRuntimeOptions(
  sessionKey: string,
  userPrompt?: string,
): Promise<ClaudeRuntimeOptions> {
  logger.info(`[claude-runtime] building runtime options, sessionKey=${sessionKey}, extensions=${claudeRuntimeExtensions.length} [${claudeRuntimeExtensions.map(e => e.id).join(', ')}]`);

  const options: ClaudeRuntimeOptions = {};
  const context: ClaudeRuntimeExtensionContext = { sessionKey, userPrompt };

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
