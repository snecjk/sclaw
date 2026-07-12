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

function parseJsonObjectFromText(text: string): ExecutionExperienceSummary {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldStore: false, reason: 'empty_model_response' };
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object'
      ? parsed as ExecutionExperienceSummary
      : { shouldStore: false, reason: 'model_response_not_object' };
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object'
          ? parsed as ExecutionExperienceSummary
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

export interface ExecutionExperiencePathItem {
  /** 具体命令/工具调用串（如 sai-cli market customer-profit-loss search --params '{...}'）。 */
  command?: string;
  /** 使用/不使用的理由。 */
  reason?: string;
}

/**
 * 执行经验摘要的强类型契约，与 buildSummaryPrompt 要求模型输出的 JSON 对齐。
 * 用于校验模型返回、并供 formatExecutionMemoryText 序列化为可检索/可注入的文本。
 */
export interface ExecutionExperienceSummary {
  shouldStore?: boolean;
  reason?: string;
  /** 任务类型一句话描述（用于匹配与展示）。 */
  intent?: string;
  /** 适用条件：何时复用本经验。 */
  applicableWhen?: string[];
  /** 下次同类任务可直接执行的目标命令（1条或按顺序多条，含参数模板/占位符）。
   *  注入后模型应优先直接执行，而非重走探索。 */
  directCommand?: ExecutionExperiencePathItem[];
  /** 探索过程（discover/help/技能触发等一次性摸索步骤）。
   *  仅当 directCommand 失效或命令可能变更时才需要，已知目标时跳过。 */
  discoveryPath?: ExecutionExperiencePathItem[];
  /** 避坑路径：不推荐的命令 + 理由。 */
  avoidPath?: ExecutionExperiencePathItem[];
  /** 参数模式：字段名 → 如何从用户问题提取/取值规则。 */
  parameterPattern?: Record<string, string>;
  /** 必须遵守的约束（如不可复用历史数值、日期不可硬编码）。 */
  constraints?: string[];
  /** 置信度 0-1。 */
  confidence?: number;
  /** 解析失败时保留原始模型输出片段。 */
  raw?: string;
  /** 对本轮实际注入经验的判断；仅作为服务端替换旧路径的建议。 */
  candidateAssessments?: ExecutionExperienceCandidateAssessment[];
}

export interface ExecutionExperienceCandidateAssessment {
  memoryId: string;
  decision: 'supersedes' | 'still_valid' | 'irrelevant_to_run' | 'uncertain';
  reason?: string;
  sameIntent?: boolean;
  oldPathAttempted?: boolean;
  oldPathFailed?: boolean;
  newPathSucceeded?: boolean;
}

function buildSummaryPrompt(input: Record<string, unknown>): string {
  const hasInjectedExperiences = Array.isArray(input.injectedExperiences) && input.injectedExperiences.length > 0;
  return [
    '请分析下面这轮 Agent 执行记录，输出 JSON：',
    '',
    JSON.stringify(input, null, 2),
    '',
    'JSON 格式：',
    '{',
    '  "shouldStore": true,',
    '  "intent": "任务类型的一句话描述（用于匹配同类任务）",',
    '  "applicableWhen": ["复用本经验的适用条件"],',
    '  "directCommand": [{"command": "下次可直接执行的目标命令串（含参数占位符）", "reason": "为什么这是命中目标、可直接复用的命令"}],',
    '  "discoveryPath": [{"command": "探索性命令（如 discover/help/技能触发）", "reason": "为什么需要这一步"}],',
    '  "avoidPath": [{"command": "具体命令或工具", "reason": "为什么不推荐"}],',
    '  "parameterPattern": {"字段名": "如何从用户问题提取/取值规则，可多字段"},',
    '  "constraints": ["必须遵守的约束，如：已知目标命令时直接执行 directCommand、跳过 discoveryPath；不可复用历史具体数值必须重新查询；日期以系统当前为基准不可硬编码"],',
    '  "confidence": 0.7',
    ...(hasInjectedExperiences ? ['  "candidateAssessments": [{"memoryId": "仅从输入 injectedExperiences 复制", "decision": "supersedes|still_valid|irrelevant_to_run|uncertain", "sameIntent": true, "oldPathAttempted": true, "oldPathFailed": true, "newPathSucceeded": true, "reason": "基于工具调用结果的简短依据"}]'] : []),
    '}',
    '',
    '要求：',
    '1. directCommand 是真正命中目标、下次同类任务可直接复用的命令（含参数模板/占位符），不要把 discover/help/技能触发这类探索性步骤放进来。',
    '2. discoveryPath 放探索过程（discover/help/技能触发等），仅在不确定或命令变更时才需要；已知目标命令时应跳过。',
    '3. directCommand/avoidPath 的 command 必须是具体命令串（含参数），不要只写工具类别名（如不要只写 Bash）。',
    ...(hasInjectedExperiences ? ['4. injectedExperiences 是本轮实际注入给模型的旧经验。只有旧路径已在本轮实际尝试且失败、并且新路径已成功完成同一目标时，才可输出 decision=supersedes。未使用或与本轮无关时必须输出 irrelevant_to_run 或 uncertain，绝不能输出 supersedes。没有工具证据时输出 uncertain。'] : []),
    '如果不值得沉淀，输出：{"shouldStore": false, "reason": "原因"}',
  ].join('\n');
}

/**
 * 从本模块 formatExecutionMemoryText 生成的文本中读取「直接执行」命令。
 * 解析与格式化放在同一模块，避免 memory-capture 与文本格式形成隐式跨文件契约。
 */
export function extractDirectExecutionCommands(memoryText: string): string[] {
  const lines = memoryText.split(/\r?\n/);
  const commands: string[] = [];
  let inDirectSection = false;
  for (const line of lines) {
    if (line.trim() === '直接执行：') { inDirectSection = true; continue; }
    if (!inDirectSection) continue;
    if (/^(参数模式|避免|探索路径（仅不确定\/命令变更时，否则跳过）|适用|约束)：/.test(line.trim())) break;
    const match = line.match(/^\s*-\s+(.+)$/);
    if (!match) continue;
    const command = match[1].split('（')[0].trim();
    // 只有“程序 + 子命令”才足以认定为一条可替代路径；单独的 sai-cli/Bash 过于宽泛。
    if (command.split(/\s+/).filter(Boolean).length >= 2) commands.push(command);
  }
  return commands;
}

/**
 * 把摘要序列化为可被 mem0 检索/注入的执行经验文本。
 * 核心可操作信息（命令、参数、避坑）前置，避免注入端截断时丢失。
 */
export function formatExecutionMemoryText(exp: ExecutionExperienceSummary): string {
  const lines: string[] = [];
  const intent = typeof exp.intent === 'string' ? exp.intent.trim() : '';
  if (intent) lines.push(`执行经验：${intent}`);
  // 顶部引导语：让模型下次优先直接执行目标命令，而非重走探索老路。
  lines.push('已知目标命令时直接执行下方"直接执行"，探索路径仅在不确定/命令变更时使用。');

  const pathLines = (items: ExecutionExperiencePathItem[] | undefined, header: string): void => {
    const steps = (items ?? []).filter((s) => s && typeof s.command === 'string' && s.command.trim());
    if (!steps.length) return;
    lines.push(header);
    for (const step of steps) {
      const cmd = step.command!.trim();
      const reason = typeof step.reason === 'string' ? step.reason.trim() : '';
      lines.push(`  - ${cmd}${reason ? `（${reason}）` : ''}`);
    }
  };
  // 目标命令最前最醒目：下次同类任务直接执行。
  pathLines(exp.directCommand, '直接执行：');
  // 参数模式紧随，便于直接执行时填参。
  if (exp.parameterPattern && typeof exp.parameterPattern === 'object') {
    const entries = Object.entries(exp.parameterPattern).filter(([, v]) => typeof v === 'string' && v.trim());
    if (entries.length) {
      lines.push('参数模式：');
      for (const [k, v] of entries) lines.push(`  - ${k}：${(v as string).trim()}`);
    }
  }
  pathLines(exp.avoidPath, '避免：');
  // 探索过程次之，明确标注"仅不确定/命令变更时"，避免模型重走老路。
  pathLines(exp.discoveryPath, '探索路径（仅不确定/命令变更时，否则跳过）：');

  const when = (exp.applicableWhen ?? []).filter((c) => typeof c === 'string' && c.trim()) as string[];
  if (when.length) lines.push(`适用：${when.map((c) => c.trim()).join('；')}`);

  const constraints = (exp.constraints ?? []).filter((c) => typeof c === 'string' && c.trim()) as string[];
  if (constraints.length) {
    lines.push(`约束：${constraints.map((c) => c.trim()).join('；')}`);
  } else {
    // 模型未给约束时兜底，保留原有安全约束。
    lines.push('约束：涉及数据、报表、状态时必须重新调用工具查询。');
  }

  if (lines.length === 0) lines.push('执行经验：可复用工具执行路径');
  return lines.join('\n');
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
  async summarize(input: Record<string, unknown>): Promise<ExecutionExperienceSummary> {
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
      const prompt = buildSummaryPrompt(input)
      logger.debug('[execution-memory][claude] summarize prompt', {
        queryId,
        prompt,
      });
      const query = sdk.query({
        prompt: prompt,
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

      logger.debug('[execution-memory][claude] summarize assistant text', {
        queryId,
        assistantText,
      });

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
