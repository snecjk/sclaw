import { getProviderAccount } from '../services/providers/provider-store';
import { getApiKey } from '../utils/secure-storage';
import { getSsoEnvironment, getStoToken } from '../utils/auth-store';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';
import { TIMEOUTS } from '../utils/config';
import { normalizeScheduledTaskInstruction } from '../../shared/scheduled-task-instruction';
import { StoModelSyncService } from '../services/providers/sto-model-sync';
import { STO_CANONICAL_ACCOUNT_ID } from '../services/providers/sto-placeholder-utils';

const BEAUTIFY_TIMEOUT_MS = TIMEOUTS.BEAUTIFY_INSTRUCTION;
const BEAUTIFY_MAX_TOKENS = 1_024;
const BEAUTIFY_INPUT_MAX_CHARS = 4_000;

const FAST_MODEL_PATTERN = /turbo|flash|lite|mini|fast|haiku|small|speed/i;
const HEAVY_MODEL_PATTERN = /plus|max|pro|opus|ultra|large|vision/i;

/** 定时任务执行描述美化（默认） */
const TASK_SYSTEM_PROMPT = [
  '你是定时任务「执行描述」优化助手。触发时间（cron）已由系统单独保存。',
  '任务：在完整保留用户执行细节（分步计划、工具/skill 名称、数据范围、输出与交付要求）的前提下，润色表述、理顺语气、去掉冗余口语。',
  '禁止：删除步骤、压缩要点、把多段描述改成一句「执行某工作流」或仅保留工作流 id。',
  '仅去除：「创建/新建/设置定时任务」「每天/每周 X 点」等调度语义。',
  '若上下文提供了关联工作流，可在开头保留或补全工作流引用，但必须保留原文全部执行细节与步骤结构。',
  '只输出优化后的纯文本，不要解释、markdown 或引号。',
].join('\n');

/** 用户创建提示词模版 / 快捷输入美化 */
const PROMPT_SYSTEM_PROMPT = [
  '你是「提示词模版」优化助手，帮助用户把常用输入润色成清晰、可复用的提示词模版。',
  '任务：在完整保留用户意图、约束条件、输出格式与关键细节的前提下，润色表述、理顺结构、补全省略不清的指令口吻，使其可直接粘贴给 AI 执行。',
  '禁止：删改核心诉求；编造用户未提及的目标、数据或步骤；改写成定时任务/工作流调度描述；过度压缩成一句空泛口号。',
  '建议：必要时用简短分点或段落提升可读性；语气保持祈使/指令风格；不要添加与原文无关的角色设定或冗长开场白。',
  '只输出优化后的纯文本提示词，不要解释、markdown 代码块或引号包裹。',
].join('\n');

export type BeautifyInstructionType = 'task' | 'prompt';

export interface BeautifyScheduledTaskInstructionInput {
  instruction: string;
  /** 美化场景：task=定时任务描述（默认），prompt=提示词模版 */
  type?: BeautifyInstructionType;
  workflowId?: string;
  workflowName?: string;
}

export interface BeautifyScheduledTaskInstructionResult {
  instruction: string;
  changed: boolean;
  source: 'model' | 'rules-fallback';
  model?: string;
}

export function resolveBeautifyType(type?: BeautifyInstructionType): BeautifyInstructionType {
  return type === 'prompt' ? 'prompt' : 'task';
}

export function resolveBeautifySystemPrompt(type?: BeautifyInstructionType): string {
  return resolveBeautifyType(type) === 'prompt' ? PROMPT_SYSTEM_PROMPT : TASK_SYSTEM_PROMPT;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function resolveOpenAiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function isMockLlmResponse(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return /biz-agent-adapter|模拟响应|联调测试|mock response|测试接口的模拟/i.test(normalized);
}

export function scoreBeautifyModel(modelId: string): number {
  let score = 0;
  if (FAST_MODEL_PATTERN.test(modelId)) score += 100;
  if (HEAVY_MODEL_PATTERN.test(modelId)) score -= 50;
  if (/qwen3\.5-plus/i.test(modelId)) score -= 30;
  return score;
}

export function pickBeautifyModel(candidates: string[], preferred?: string): string {
  const unique = [...new Set(candidates.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('未获取到可用的 STO 模型');
  }

  const ranked = [...unique].sort((left, right) => scoreBeautifyModel(right) - scoreBeautifyModel(left));
  const best = ranked[0]!;
  const preferredTrimmed = preferred?.trim();

  if (
    preferredTrimmed
    && unique.includes(preferredTrimmed)
    && scoreBeautifyModel(preferredTrimmed) >= scoreBeautifyModel(best)
  ) {
    return preferredTrimmed;
  }

  return best;
}

async function resolveStoBeautifyModel(token: string, domain: string): Promise<string> {
  const account = await getProviderAccount(STO_CANONICAL_ACCOUNT_ID);
  const preferred = account?.model?.trim()
    || (Array.isArray(account?.metadata?.customModels) ? String(account.metadata.customModels[0] ?? '').trim() : '');

  const catalogIds = Array.isArray(account?.metadata?.customModels)
    ? account.metadata.customModels.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (catalogIds.length > 0) {
    return pickBeautifyModel(catalogIds, preferred);
  }

  const sync = new StoModelSyncService();
  const remoteModels = await sync.fetchRemoteModels(domain, token);
  const remoteIds = remoteModels.map((model) => model.id?.trim()).filter(Boolean) as string[];
  return pickBeautifyModel(remoteIds, preferred);
}

function truncateInstructionForModel(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= BEAUTIFY_INPUT_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, BEAUTIFY_INPUT_MAX_CHARS)}\n\n（上文已截断，请保留核心执行意图并优化表述）`;
}

function buildUserPrompt(input: BeautifyScheduledTaskInstructionInput): string {
  const beautifyType = resolveBeautifyType(input.type);
  if (beautifyType === 'prompt') {
    return ['用户原始提示词：', truncateInstructionForModel(input.instruction)].join('\n');
  }

  const lines = [
    input.workflowId?.trim()
      ? `关联工作流：id=${input.workflowId.trim()}，名称=${input.workflowName?.trim() || input.workflowId.trim()}`
      : null,
    '用户原始描述：',
    truncateInstructionForModel(input.instruction),
  ].filter(Boolean);

  return lines.join('\n');
}

export function isOverCollapsed(original: string, optimized: string): boolean {
  const orig = original.trim();
  const opt = optimized.trim();
  if (!orig || !opt) return false;
  if (opt.length >= orig.length * 0.55) return false;

  const origLines = orig.split(/\n+/).filter((line) => line.trim()).length;
  const origSteps = (orig.match(/第[一二三四五六七八九十\d]+步|步骤\s*[\d一二三四五六七八九十]/gi) || []).length;
  const hasStructuredPlan = origLines >= 3 || origSteps >= 2 || orig.length >= 280;

  return hasStructuredPlan && opt.length < orig.length * 0.45;
}

function normalizeRulesFallbackInstruction(
  input: BeautifyScheduledTaskInstructionInput,
): ReturnType<typeof normalizeScheduledTaskInstruction> {
  return normalizeScheduledTaskInstruction({
    instruction: input.instruction,
    // Beautify fallback only strips schedule/meta-task phrasing — never replace with workflow template.
    workflowId: undefined,
    workflowName: undefined,
  });
}

function sanitizeModelOutput(text: string): string {
  let result = text.trim();
  if (result.startsWith('```')) {
    result = result.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  }
  if (
    (result.startsWith('"') && result.endsWith('"'))
    || (result.startsWith('「') && result.endsWith('」'))
    || (result.startsWith('『') && result.endsWith('』'))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function extractOpenAiCompletionText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  return null;
}

async function callChatCompletions(params: {
  url: string;
  headers: Record<string, string>;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const startedAt = Date.now();
  const response = await proxyAwareFetch(params.url, {
    method: 'POST',
    headers: {
      ...params.headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      max_tokens: BEAUTIFY_MAX_TOKENS,
      temperature: 0.2,
    }),
    timeoutMs: BEAUTIFY_TIMEOUT_MS,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`模型请求失败 (${response.status})`);
  }

  const text = extractOpenAiCompletionText(data);
  if (!text) {
    throw new Error('模型返回为空');
  }
  logger.info(`[scheduled-task-beautify] model responded in ${Date.now() - startedAt}ms model=${params.model}`);
  return sanitizeModelOutput(text);
}

async function beautifyWithStoAccount(
  userPrompt: string,
  systemPrompt: string,
): Promise<{ text: string; model: string }> {
  const token = await getStoToken();
  if (!token) {
    throw new Error('未登录 STO，无法使用 AI 美化');
  }

  const account = await getProviderAccount(STO_CANONICAL_ACCOUNT_ID);
  const baseUrl = account?.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error('STO 模型未配置');
  }

  const apiKey = (await getApiKey(STO_CANONICAL_ACCOUNT_ID))?.trim() || token;
  const env = await getSsoEnvironment();
  const domain = StoModelSyncService.resolveDomain(env);
  const model = await resolveStoBeautifyModel(token, domain);
  const url = resolveOpenAiChatCompletionsUrl(baseUrl);

  logger.info(`[scheduled-task-beautify] request url=${url} model=${model}`);
  const text = await callChatCompletions({
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    model,
    systemPrompt,
    userPrompt,
  });

  if (isMockLlmResponse(text)) {
    throw new Error('收到无效的模型模拟响应');
  }
  return { text, model };
}

export async function beautifyScheduledTaskInstruction(
  input: BeautifyScheduledTaskInstructionInput,
): Promise<BeautifyScheduledTaskInstructionResult> {
  const original = input.instruction.trim();
  if (!original) {
    throw new Error('instruction is required');
  }

  const beautifyType = resolveBeautifyType(input.type);
  const systemPrompt = resolveBeautifySystemPrompt(beautifyType);
  const userPrompt = buildUserPrompt(input);
  const rulesResult =
    beautifyType === 'prompt'
      ? { instruction: original, changed: false }
      : normalizeRulesFallbackInstruction(input);

  try {
    const { text: optimized, model } = await beautifyWithStoAccount(userPrompt, systemPrompt);
    if (!optimized || isMockLlmResponse(optimized)) {
      throw new Error('模型返回为空或无效');
    }
    if (isOverCollapsed(original, optimized)) {
      throw new Error('模型输出过度压缩，已丢弃');
    }

    return {
      instruction: optimized,
      changed: optimized !== original,
      source: 'model',
      model,
    };
  } catch (error) {
    logger.warn('[scheduled-task-beautify] model beautify failed, falling back to rules', error);
    return {
      instruction: rulesResult.instruction,
      changed: rulesResult.changed,
      source: 'rules-fallback',
    };
  }
}
