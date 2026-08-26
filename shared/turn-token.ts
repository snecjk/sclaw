export type TurnEngineType = 'claude';

export interface NormalizedTurnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TurnTokenUsage extends NormalizedTurnUsage {
  engineType: TurnEngineType;
  sessionKey: string;
  turnIndex: number;
  model?: string;
  emittedAt: string;
}

export function normalizeTurnUsage(raw: unknown): NormalizedTurnUsage {
  const usage = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const promptTokens = readUsageNumber(
    usage.input,
    usage.promptTokens,
    usage.inputTokens,
    usage.prompt_tokens,
    usage.input_tokens,
  );
  const completionTokens = readUsageNumber(
    usage.output,
    usage.completionTokens,
    usage.outputTokens,
    usage.completion_tokens,
    usage.output_tokens,
  );
  const cacheRead = readUsageNumber(
    usage.cacheRead,
    usage.cache_read,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
  );
  const cacheWrite = readUsageNumber(
    usage.cacheWrite,
    usage.cache_write,
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
  );
  const explicitTotal = readOptionalUsageNumber(usage.total, usage.totalTokens, usage.total_tokens);
  const totalTokens = explicitTotal ?? (promptTokens + completionTokens + cacheRead + cacheWrite);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function readOptionalUsageNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return undefined;
}

function readUsageNumber(...values: unknown[]): number {
  return readOptionalUsageNumber(...values) ?? 0;
}

export function formatTurnTokenCount(value: number): string {
  return Math.max(0, value).toLocaleString('zh-CN');
}

/** 从 Claude SDK result 消息提取 usage（含 modelUsage 回退）。 */
export function extractClaudeResultUsage(resultMessage: unknown): NormalizedTurnUsage | null {
  const record = resultMessage && typeof resultMessage === 'object'
    ? resultMessage as Record<string, unknown>
    : null;
  if (!record) return null;

  const direct = normalizeTurnUsage(record.usage);
  if (direct.promptTokens > 0 || direct.completionTokens > 0 || direct.totalTokens > 0) {
    return direct;
  }

  const modelUsage = record.modelUsage ?? record.model_usage;
  if (!modelUsage || typeof modelUsage !== 'object') return null;

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const entry of Object.values(modelUsage as Record<string, unknown>)) {
    const normalized = normalizeTurnUsage(entry);
    promptTokens += normalized.promptTokens;
    completionTokens += normalized.completionTokens;
    totalTokens += normalized.totalTokens;
  }
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) return null;
  if (totalTokens <= 0) totalTokens = promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}
