import { randomUUID } from "node:crypto";

export type ConversationMessageDraft = {
  message_id: string;
  session_id: string;
  run_id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  model_name?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  emitted_at: string;
  agent_id?: string;
  channel_id?: string;
  source_platform: string;
  content_truncated?: boolean;
};

interface TranscriptUsageShape {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cache_read?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function parseUsageTokens(usage?: TranscriptUsageShape): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const promptTokens =
    usage?.input ?? usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
  const completionTokens =
    usage?.output ?? usage?.completionTokens ?? usage?.completion_tokens ?? 0;
  const cacheRead = usage?.cacheRead ?? usage?.cache_read ?? 0;
  const totalTokens =
    usage?.total ??
    usage?.totalTokens ??
    usage?.total_tokens ??
    promptTokens + completionTokens + cacheRead;
  return { promptTokens, completionTokens, totalTokens };
}

interface TranscriptLineShape {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    modelRef?: string;
    provider?: string;
    usage?: TranscriptUsageShape;
    content?: unknown;
  };
}

function normalizeMessageContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const chunks: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        const block = item as Record<string, unknown>;
        if (block.type === "thinking" && typeof block.thinking === "string") {
          const thinking = block.thinking.trim();
          if (thinking.length > 0) {
            chunks.push(thinking);
          }
          continue;
        }
      }
      const normalized = normalizeMessageContent(item);
      if (normalized) {
        chunks.push(normalized);
      }
    }
    return chunks.length > 0 ? chunks.join("\n\n") : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      const trimmed = record.text.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (Array.isArray(record.content)) {
      return normalizeMessageContent(record.content);
    }
    if (typeof record.content === "string") {
      const trimmed = record.content.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

function stripCredentials(content: string): string {
  return content
    .replace(/Bearer\s+\S+/gi, "[REDACTED]")
    .replace(/(stoToken|X-Sto-Token)\s*[:=]\s*['"]?\S+/gi, "[REDACTED]")
    .replace(/(api[_-]?key|apiKey|secret)\s*[:=]\s*['"]?\S+/gi, "[REDACTED]");
}

type ParsedLine = {
  timestamp: string;
  role: string;
  content?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function parseLine(raw: string): ParsedLine | null {
  let parsed: TranscriptLineShape;
  try {
    parsed = JSON.parse(raw) as TranscriptLineShape;
  } catch {
    return null;
  }
  const message = parsed.message;
  if (!message?.role || !parsed.timestamp) {
    return null;
  }
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }

  const { promptTokens, completionTokens, totalTokens } = parseUsageTokens(message.usage);

  const content = normalizeMessageContent(message.content);
  if (!content) {
    return null;
  }

  return {
    timestamp: parsed.timestamp,
    role,
    content,
    model: message.model ?? message.modelRef,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

type ConversationTurn = {
  user?: ParsedLine;
  assistant?: ParsedLine;
};

/** 将同一轮内连续的 assistant 合并为一条（Token 取最后一次模型调用的 usage）。 */
function mergeAssistantLines(lines: ParsedLine[]): ParsedLine | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const last = lines[lines.length - 1];
  const content = lines
    .map((line) => line.content?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
  return {
    ...last,
    content: content || last.content,
  };
}

/** 按时间顺序将 user 与紧随其后的 assistant（可多条）配成多轮问答。 */
export function pairTurnsFromParsed(parsed: ParsedLine[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let pendingUser: ParsedLine | undefined;
  let pendingAssistants: ParsedLine[] = [];

  const flushAssistants = () => {
    const assistant = mergeAssistantLines(pendingAssistants);
    pendingAssistants = [];
    if (!assistant && !pendingUser) {
      return;
    }
    turns.push({ user: pendingUser, assistant });
    pendingUser = undefined;
  };

  for (const item of parsed) {
    if (item.role === "user") {
      flushAssistants();
      pendingUser = item;
      continue;
    }
    if (item.role === "assistant") {
      pendingAssistants.push(item);
      continue;
    }
    if (item.role === "system") {
      flushAssistants();
      pendingUser = undefined;
    }
  }

  flushAssistants();
  if (pendingUser) {
    turns.push({ user: pendingUser });
  }
  return turns;
}

/**
 * 从 transcript 提取会话内全部一问一答。
 * 最后一轮使用当前 agent_end 的 runId；历史轮次使用稳定占位 runId 便于幂等。
 */
function parseUserAssistantLines(content: string): ParsedLine[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    const item = parseLine(line);
    if (item && (item.role === "user" || item.role === "assistant")) {
      parsed.push(item);
    }
  }
  return parsed;
}

function pairTurnsFromContent(content: string): ConversationTurn[] {
  return pairTurnsFromParsed(parseUserAssistantLines(content));
}

/** 统计 transcript 中已完成的一问一答轮数（用于 agent_end 缺 runId 时的稳定占位）。 */
export function countConversationTurns(content: string): number {
  return pairTurnsFromContent(content).length;
}

/** 至少包含 user + assistant 的完整轮次数量。 */
export function countCompleteConversationTurns(content: string): number {
  return pairTurnsFromContent(content).filter((turn) => turn.user && turn.assistant).length;
}

/** 末尾是否仍有「只有问、没有答」的未完成轮。 */
export function hasPendingUserTurn(content: string): boolean {
  const turns = pairTurnsFromContent(content);
  if (turns.length === 0) {
    return false;
  }
  const last = turns[turns.length - 1];
  return Boolean(last.user && !last.assistant);
}

/** 最后一条 assistant 的 stopReason（判断是否仍在工具调用阶段）。 */
export function getLastAssistantStopReason(content: string): string | undefined {
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as TranscriptLineShape;
      if (parsed.message?.role === "assistant") {
        const stopReason = (parsed.message as { stopReason?: string }).stopReason;
        return typeof stopReason === "string" ? stopReason : undefined;
      }
    } catch {
      // skip malformed lines
    }
  }
  return undefined;
}

/**
 * transcript 是否满足「可上报」：
 * - 至少一轮完整问答；
 * - 最后一条 assistant 已结束工具调用（stopReason !== toolUse）。
 * 末尾悬空 user 由 extractSyncableTurnsFromJsonl 排除。
 */
export function isTranscriptReadyForSync(content: string): boolean {
  if (countCompleteConversationTurns(content) === 0) {
    return false;
  }
  return getLastAssistantStopReason(content) !== "toolUse";
}

/**
 * 仅提取含 assistant 的轮次（跳过末尾未完成的 user），供远程同步上报。
 */
export function extractSyncableTurnsFromJsonl(
  content: string,
  params: {
    sessionId: string;
    runId: string;
    agentId?: string;
    channelId?: string;
  },
): ConversationMessageDraft[] {
  const turns = pairTurnsFromContent(content).filter((turn) => turn.assistant);
  if (turns.length === 0) {
    return [];
  }

  const messages: ConversationMessageDraft[] = [];
  const base = {
    session_id: params.sessionId,
    agent_id: params.agentId,
    channel_id: params.channelId,
    source_platform: "openclaw",
  };

  turns.forEach((turn, index) => {
    const turnIndex = index + 1;
    const isLast = turnIndex === turns.length;
    const runId = isLast ? params.runId : `${params.sessionId}:turn:${turnIndex}`;
    const userSeq = (turnIndex - 1) * 2 + 1;
    const assistantSeq = userSeq + 1;

    if (turn.user) {
      messages.push({
        ...base,
        run_id: runId,
        message_id: `${params.sessionId}:turn:${turnIndex}:user`,
        sequence: userSeq,
        role: "user",
        content: stripCredentials(turn.user.content ?? ""),
        model_name: undefined,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        emitted_at: turn.user.timestamp,
      });
    }

    if (turn.assistant) {
      messages.push({
        ...base,
        run_id: runId,
        message_id: `${params.sessionId}:turn:${turnIndex}:assistant`,
        sequence: assistantSeq,
        role: "assistant",
        content: stripCredentials(turn.assistant.content ?? ""),
        model_name: turn.assistant.model,
        prompt_tokens: turn.assistant.promptTokens,
        completion_tokens: turn.assistant.completionTokens,
        total_tokens: turn.assistant.totalTokens,
        emitted_at: turn.assistant.timestamp,
      });
    }
  });

  return messages;
}

export function extractAllTurnsFromJsonl(
  content: string,
  params: {
    sessionId: string;
    runId: string;
    agentId?: string;
    channelId?: string;
  },
): ConversationMessageDraft[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    const item = parseLine(line);
    if (item && (item.role === "user" || item.role === "assistant")) {
      parsed.push(item);
    }
  }

  const turns = pairTurnsFromParsed(parsed);
  if (turns.length === 0) {
    return [];
  }

  const messages: ConversationMessageDraft[] = [];
  const base = {
    session_id: params.sessionId,
    agent_id: params.agentId,
    channel_id: params.channelId,
    source_platform: "openclaw",
  };

  turns.forEach((turn, index) => {
    const turnIndex = index + 1;
    const isLast = turnIndex === turns.length;
    const runId = isLast ? params.runId : `${params.sessionId}:turn:${turnIndex}`;
    const userSeq = (turnIndex - 1) * 2 + 1;
    const assistantSeq = userSeq + 1;

    if (turn.user) {
      messages.push({
        ...base,
        run_id: runId,
        message_id: `${params.sessionId}:turn:${turnIndex}:user`,
        sequence: userSeq,
        role: "user",
        content: stripCredentials(turn.user.content ?? ""),
        model_name: undefined,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        emitted_at: turn.user.timestamp,
      });
    }

    if (turn.assistant) {
      messages.push({
        ...base,
        run_id: runId,
        message_id: `${params.sessionId}:turn:${turnIndex}:assistant`,
        sequence: turn.assistant ? assistantSeq : userSeq,
        role: "assistant",
        content: stripCredentials(turn.assistant.content ?? ""),
        model_name: turn.assistant.model,
        prompt_tokens: turn.assistant.promptTokens,
        completion_tokens: turn.assistant.completionTokens,
        total_tokens: turn.assistant.totalTokens,
        emitted_at: turn.assistant.timestamp,
      });
    }
  });

  return messages;
}

/** @deprecated 使用 extractAllTurnsFromJsonl */
export function extractLatestTurnFromJsonl(
  content: string,
  params: {
    sessionId: string;
    runId: string;
    agentId?: string;
    channelId?: string;
  },
): ConversationMessageDraft[] {
  return extractAllTurnsFromJsonl(content, params);
}

export function newConversationBatchId(): string {
  return randomUUID();
}
