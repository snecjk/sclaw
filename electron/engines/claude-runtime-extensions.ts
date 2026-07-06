import type { HookCallbackMatcher, HookEvent, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { RETIRED_SKILLS_SYSTEM_PROMPT } from '../../shared/retired-skills';
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
  isScheduledTaskExecutionSessionKey,
  SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT,
} from '../../shared/scheduled-task-instruction';
import {
  buildStoAgentTelemetryClaudeRuntimeOptions,
} from '../../sto-plugin/claude/sto-agent-telemetry/sdk';
import { getAuthState, getStoToken } from '../utils/auth-store';
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

const scheduledTaskToolExtension: ClaudeRuntimeExtension = {
  id: 'claude-scheduled-task-tool',
  async build({ sessionKey }) {
    const isExecutionContext = isScheduledTaskExecutionSessionKey(sessionKey);
    if (isExecutionContext) {
      return {
        hooks: buildScheduledTaskHooks(sessionKey),
        systemPromptAppend: SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT,
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

const agentTelemetryExtension: ClaudeRuntimeExtension = {
  id: 'sto-agent-telemetry',
  build: ({ sessionKey }) => buildStoAgentTelemetryClaudeRuntimeOptions(sessionKey),
};

const ssoUserContextExtension: ClaudeRuntimeExtension = {
  id: 'sto-sso-user-context',
  async build() {
    const blocks: string[] = [RETIRED_SKILLS_SYSTEM_PROMPT];

    blocks.push([
      '产物文件引用规范（重要）：',
      '- 写入：本地产物必须 save 到当前 workspace 的 `./.claw-output/<文件名>`；⛔ 禁止 `outputs/`、项目源码目录、skill 目录；⛔ 禁止 `~/.openclaw/workspace`（旧路径），统一使用 `~/.stoclaw/openclaw/workspace/.claw-output/`。',
      '- 路径一致：回复里的 file:/// 绝对路径必须与 write/save 实际路径逐字相同（含文件名）；⛔ 禁止写 A 名、链 B 名。',
      '- 当回复中引用用户可查看或下载的本地产物文件（HTML 报告、PDF、表格、文档等）时，必须输出绝对路径，并优先使用 file:// URL 的 Markdown 链接格式：[文件名](file:///绝对路径)。',
      '- 严禁输出相对路径链接（如 [report.md](report.md)、outputs/...、./.claw-output/...、./...）；必须写成绝对路径。',
      '- Windows 路径必须规范为 file:///C:/...（使用正斜杠），不要输出 file://C:\\... 或反斜杠版本。',
      '- 如果执行结果仅提供 http(s) 可访问地址（如 OSS 链接）且没有本地绝对路径，则使用该 http(s) 链接；不要伪造 file:// 路径。',
      '- 严禁向用户输出运行环境内部且用户不可访问的伪本地路径（如 /runtime/、/tmp/）作为 file:// 链接。',
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

const claudeRuntimeExtensions: ClaudeRuntimeExtension[] = [
  dingTalkSendGuardExtension,
  workflowToolExtension,
  scheduledTaskToolExtension,
  agentTelemetryExtension,
  ssoUserContextExtension,
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
