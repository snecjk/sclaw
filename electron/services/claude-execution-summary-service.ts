import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDefaultProviderAccountId, getProviderAccount } from './providers/provider-store';
import { StoModelSyncService } from './providers/sto-model-sync';
import { getAgentPreferredModel, getAgentWorkspacePath } from '../utils/agent-config';
import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { getClaudeConfigDir } from '../utils/paths';
import { getApiKey } from '../utils/secure-storage';

let claudeConfigEnvQueue: Promise<void> = Promise.resolve();
let ensureClaudeConfigDirPromise: Promise<void> | null = null;

function getBundledClaudeExecutablePath(): string | undefined {
  if (!process.resourcesPath) return undefined;

  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const packageName = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const candidate = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    packageName,
    binaryName,
  );

  return existsSync(candidate) ? candidate : undefined;
}

async function ensureClaudeConfigDir(): Promise<void> {
  if (ensureClaudeConfigDirPromise) {
    await ensureClaudeConfigDirPromise;
    return;
  }
  ensureClaudeConfigDirPromise = mkdir(getClaudeConfigDir(), { recursive: true })
    .catch((error) => {
      logger.warn('[execution-memory][claude] failed to ensure Claude config dir:', error);
    })
    .then(() => {});
  await ensureClaudeConfigDirPromise;
}

async function withClaudeConfigDirEnv<T>(configDir: string, task: () => Promise<T>): Promise<T> {
  const next = claudeConfigEnvQueue.then(async () => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      return await task();
    } finally {
      if (typeof previous === 'string') {
        process.env.CLAUDE_CONFIG_DIR = previous;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    }
  });

  claudeConfigEnvQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function sanitizeClaudeSettingsEnv(): Promise<void> {
  const settingsPath = join(getClaudeConfigDir(), 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings.env as Record<string, unknown> | undefined;
    if (!env || typeof env !== 'object') return;

    let changed = false;
    for (const key of Object.keys(env)) {
      if (key.startsWith('ANTHROPIC_')) {
        delete env[key];
        changed = true;
      }
    }

    if (changed) {
      settings.env = env;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      logger.info('[execution-memory][claude] stripped ANTHROPIC_* env vars from settings.json');
    }
  } catch {
    // Ignore missing or unreadable settings.
  }
}

async function buildClaudeEnvForAccount(accountId?: string): Promise<NodeJS.ProcessEnv> {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: getClaudeConfigDir(),
  };

  if (!accountId) return base;
  const account = await getProviderAccount(accountId);
  if (!account) return base;

  if (account.vendorId === 'sto') {
    const token = await getStoToken();
    const ssoEnv = await getSsoEnvironment();
    const domain = StoModelSyncService.resolveDomain(ssoEnv);
    if (token) {
      const baseUrl = `${domain}/v1/anthropic`;
      base.ANTHROPIC_BASE_URL = baseUrl;
      base.ANTHROPIC_API_KEY = token;
      base.ANTHROPIC_AUTH_TOKEN = token;
    }
    return base;
  }

  const apiKey = await getApiKey(accountId);
  if (account.baseUrl) {
    base.ANTHROPIC_BASE_URL = account.baseUrl;
  }
  if (apiKey) {
    base.ANTHROPIC_API_KEY = apiKey;
    base.ANTHROPIC_AUTH_TOKEN = apiKey;
  }
  return base;
}

async function resolveLaunchSelection(agentId: string): Promise<{
  accountId?: string;
  model?: string;
}> {
  const preferred = await getAgentPreferredModel(agentId);
  let accountId = preferred.accountId ?? await getDefaultProviderAccountId();
  let model = preferred.model;

  if (!model && accountId) {
    const account = await getProviderAccount(accountId);
    model = account?.model;
  }

  return { accountId, model };
}

function extractAssistantText(message: Record<string, unknown>): string {
  if (message.type !== 'assistant' || !('message' in message)) return '';
  const payload = (message as { message?: { content?: unknown } }).message;
  const content = payload?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const record = block as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldStore: false, reason: 'empty_model_response' };
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : { shouldStore: false, reason: 'model_response_not_object' };
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object'
          ? parsed as Record<string, unknown>
          : { shouldStore: false, reason: 'model_response_not_object' };
      } catch {
        // Fall through to structured failure below.
      }
    }
  }
  return {
    shouldStore: false,
    reason: 'model_response_json_parse_failed',
    raw: trimmed.slice(0, 500),
  };
}

function buildSummaryPrompt(input: Record<string, unknown>): string {
  return [
    '请分析下面这轮 Agent 执行记录，输出 JSON：',
    '',
    JSON.stringify(input, null, 2),
    '',
    'JSON 格式：',
    '{',
    '  "shouldStore": true,',
    '  "intent": "类似任务类型",',
    '  "taskSignature": "稳定的任务签名",',
    '  "applicableWhen": ["适用条件"],',
    '  "successfulPath": [{"toolName": "工具名", "reason": "为什么应该用"}],',
    '  "avoidPath": [{"toolName": "工具名", "reason": "为什么不推荐"}],',
    '  "parameterPattern": {"date": "从用户问题中提取日期"},',
    '  "constraints": ["不要复用历史具体数值，必须重新查询"],',
    '  "confidence": 0.7',
    '}',
    '',
    '如果不值得沉淀，输出：{"shouldStore": false, "reason": "原因"}',
  ].join('\n');
}

const SUMMARY_SYSTEM_PROMPT = [
  '你是 StoClaw Agent 执行经验总结器。',
  '你的任务是根据一轮用户任务、最终回答、工具调用摘要，判断是否值得沉淀为长期执行经验。',
  '只总结以后遇到类似任务时，应该如何选择工具、组织参数、避开什么错误路径。',
  '禁止记录本次查询得到的具体业务数值、报表结果、订单量、金额等。',
  '禁止记录大段原始工具返回、临时上下文、用户一次性问题本身。',
  '只输出 JSON，不要输出 Markdown。',
].join('\n');

export class ClaudeExecutionSummaryService {
  async summarize(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const agentId = typeof input.agentId === 'string' && input.agentId.trim()
      ? input.agentId.trim()
      : 'main';
    await ensureClaudeConfigDir();
    await sanitizeClaudeSettingsEnv();

    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const launch = await resolveLaunchSelection(agentId);
    const cwd = await getAgentWorkspacePath(agentId) || process.cwd();
    const queryId = randomUUID();

    logger.info('[execution-memory][claude] summarize start', {
      queryId,
      agentId,
      model: launch.model,
      accountId: launch.accountId,
    });

    return await withClaudeConfigDirEnv(getClaudeConfigDir(), async () => {
      const query = sdk.query({
        prompt: buildSummaryPrompt(input),
        options: {
          cwd,
          env: await buildClaudeEnvForAccount(launch.accountId),
          settingSources: ['user' as const],
          settings: launch.model ? { model: launch.model } : undefined,
          pathToClaudeCodeExecutable: getBundledClaudeExecutablePath(),
          includePartialMessages: false,
          skills: [],
          mcpServers: {},
          hooks: {},
          plugins: [],
          systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: SUMMARY_SYSTEM_PROMPT,
          },
        } as any,
      }) as AsyncIterable<Record<string, unknown>> & { close(): void };

      let timedOut = false;
      let assistantText = '';
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          query.close();
        } catch {
          // Ignore close failures; the caller will receive a structured skip.
        }
      }, 60_000);

      try {
        for await (const message of query) {
          const text = extractAssistantText(message);
          if (text) assistantText = text;
        }
      } finally {
        clearTimeout(timer);
      }

      if (timedOut && !assistantText) {
        logger.warn('[execution-memory][claude] summarize timeout', { queryId });
        return { shouldStore: false, reason: 'claude_summary_timeout' };
      }

      const parsed = parseJsonObjectFromText(assistantText);
      logger.info('[execution-memory][claude] summarize done', {
        queryId,
        shouldStore: parsed.shouldStore,
        reason: parsed.reason,
        assistantTextLength: assistantText.length,
      });
      return parsed;
    });
  }
}

export const claudeExecutionSummaryService = new ClaudeExecutionSummaryService();
