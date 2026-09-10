/**
 * 工具空转防护（纯逻辑，无 SDK 依赖）。
 *
 * 只拦**连续**的同名同参调用：`list_sessions → list_sessions → list_sessions …`
 * 这种没有任何中间动作的重复才是空转。中间只要插入了别的工具调用，计数就归零，
 * 因此"点击 → 快照 → 点击 → 快照"这类参数相同但状态已变的合法序列不受影响。
 */

/** 连续第 N+1 次同名同参调用被拦截。 */
export const CLAUDE_TOOL_REPEAT_LIMIT = 3;

/**
 * 拦截后模型仍无视 deny、继续同参调用时，在这个 count 掐掉 query。
 * 判定阈值不变（第 4 次起 deny）；这是 deny 被忽略之后的熔断，不是把检测收得更紧。
 */
export const CLAUDE_TOOL_REPEAT_ABORT_COUNT = 6;

const SIGNATURE_MAX_DEPTH = 4;

/** MCP 工具名形如 mcp__server__tool，签名只取末段。 */
export function normalizeToolNameForSignature(toolName: string): string {
  const parts = toolName.split('__');
  return parts[parts.length - 1] || toolName;
}

function stableStringify(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (depth >= SIGNATURE_MAX_DEPTH) return '"…"';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, depth + 1)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], depth + 1)}`)
    .join(',');
  return `{${body}}`;
}

/**
 * 路由字段不参与签名。
 *
 * 实测：模型在同一个 ref 上连点 16 次，每次换一个自己编的 sessionId。若把
 * sessionId 计入签名，每次都是"新调用"，空转防护完全失效——而这恰恰是最典型的空转。
 */
const VOLATILE_INPUT_KEYS = new Set(['sessionId', 'session_id']);

export function buildToolCallSignature(toolName: string, input: unknown): string {
  let payload = input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    payload = Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !VOLATILE_INPUT_KEYS.has(key)),
    );
  }
  return `${normalizeToolNameForSignature(toolName)}#${stableStringify(payload)}`;
}

export interface ToolRepeatDecision {
  blocked: boolean;
  /** 当前签名的连续次数（含本次）。 */
  count: number;
}

/** deny 已经发出去、模型还在同一签名上空转时，应该关掉 query。 */
export function shouldAbortRepeatedTool(decision: ToolRepeatDecision): boolean {
  return decision.blocked && decision.count >= CLAUDE_TOOL_REPEAT_ABORT_COUNT;
}

export interface ToolRepeatTracker {
  record(signature: string): ToolRepeatDecision;
  reset(): void;
}

export function createToolRepeatTracker(limit = CLAUDE_TOOL_REPEAT_LIMIT): ToolRepeatTracker {
  let lastSignature: string | null = null;
  let count = 0;

  return {
    record(signature: string): ToolRepeatDecision {
      if (signature === lastSignature) {
        count += 1;
      } else {
        lastSignature = signature;
        count = 1;
      }
      return { blocked: count > limit, count };
    },
    reset(): void {
      lastSignature = null;
      count = 0;
    },
  };
}

/**
 * 拦截话术必须给出下一步，而不是只说"别重复"——否则模型会换个工具继续空转。
 */
export function buildToolRepeatBlockReason(input: {
  toolName: string;
  count: number;
}): string {
  const shortName = normalizeToolNameForSignature(input.toolName);
  const lines = [
    `已连续第 ${input.count} 次以完全相同的参数调用 ${shortName}，判定为空转，本次拦截。`,
    '前几次的返回已经在上下文里：请直接用已有结果写结论或推进下一步，不要重复探测。',
    '确实需要再调用时，必须改变参数（换目标、换 ref、换范围）或换一个能推进任务的工具。',
  ];
  if (/session|list/i.test(shortName)) {
    lines.push('若上一次返回了会话失效（SESSION_STALE），直接用返回里的 currentSessionId，不要重新枚举会话。');
  }
  return lines.join('\n');
}
