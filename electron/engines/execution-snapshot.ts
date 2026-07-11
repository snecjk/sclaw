/**
 * 执行经验快照解析 —— 纯函数，不依赖任何引擎 adapter 或服务状态。
 *
 * 从一轮对话的历史消息中提取「最后一个有文本的 assistant（最终回答）+ 前一个
 * user（本轮任务）+ 其间的工具调用」，按 toolCallId/tool_use_id 把 tool_use
 * （请求）与 tool_result（结果）合并到同一条目。
 *
 * 兼容两种消息格式（与 src/stores/chat/helpers.ts 的双格式写法一致）：
 *  - Anthropic/normalized（Claude）：tool_use 是内容块 type=tool_use + input；
 *    tool_result 是 user 消息里 type=tool_result 内容块 + tool_use_id + is_error。
 *  - OpenAI/OpenClaw：tool_use 是消息级 tool_calls[].function.{name,arguments}；
 *    tool_result 是 role=tool 的独立消息 + toolCallId + isError。
 *
 * 引擎格式差异在这里以格式驱动分支处理，避免把格式知识散落到各 adapter 或
 * memory-capture 编排层。
 */
import type { EngineHistoryResult } from './types';

export type Tool = {
  toolCallId?: string;
  name: string;
  status: 'completed' | 'error';
  summary?: string;
  /** Bash 类工具的实际命令串（如 sai-cli ... --params '{...}'），来自 tool_use.input.command。 */
  command?: string;
  /** 工具调用的用途说明，来自 tool_use.input.description。 */
  description?: string;
  /** tool_use 的原始入参对象，供 summary 模型参考具体参数。 */
  input?: Record<string, unknown> | null;
};

export type ExecutionSnapshot = {
  userMessage: string;
  assistantMessage: string;
  tools: Tool[];
  /** 本轮解析所基于的历史消息总数（诊断用）。 */
  messageCount: number;
};

const TOOL_USE_TYPES = ['tool_use', 'tool-call', 'tool_call'];
const TOOL_RESULT_BLOCK_TYPES = ['tool_result', 'toolresult', 'tool-result', 'toolCallResult'];
const TOOL_RESULT_ROLES = ['tool', 'toolresult', 'tool_result'];

function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((b) => b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string' ? (b as Record<string, unknown>).text : '')
      .join('\n')
      .trim();
  }
  return '';
}

function messageText(m: Record<string, unknown>): string {
  return contentText(m.content);
}

/**
 * 解析一轮对话历史，提取执行经验快照。
 *
 * @param messages gateway/adapter 返回的历史消息（原生格式，未做归一化）。
 * @returns 快照；若找不到「有文本的 assistant + 前一个 user」则返回 null。
 */
export function parseExecutionTurn(messages: Record<string, unknown>[]): ExecutionSnapshot | null {
  // 找最后一个「有文本」的 assistant 消息（即最终回答）。
  let ai = messages.length - 1;
  while (ai >= 0 && (String(messages[ai].role).toLowerCase() !== 'assistant' || !messageText(messages[ai]))) ai--;
  if (ai < 0) return null;

  // 找它前一个「有文本」的 user 消息（即本轮用户任务）。
  let ui = ai - 1;
  while (ui >= 0 && (String(messages[ui].role).toLowerCase() !== 'user' || !messageText(messages[ui]))) ui--;
  if (ui < 0) return null;

  const byId = new Map<string, Tool>();
  let serial = 0;
  const nextKey = (): string => `unknown-${serial++}`;

  for (const message of messages.slice(ui + 1, ai + 1)) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const r = block as Record<string, unknown>;
      const blockType = String(r.type);

      // Anthropic 格式：tool_use 内容块。
      if (TOOL_USE_TYPES.includes(blockType)) {
        const key = String(r.id || nextKey());
        const args = (r.input ?? r.arguments) as Record<string, unknown> | undefined;
        byId.set(key, {
          toolCallId: typeof r.id === 'string' ? r.id : undefined,
          name: String(r.name || r.toolName || 'unknown_tool'),
          status: 'completed',
          command: args && typeof args.command === 'string' ? args.command : undefined,
          description: args && typeof args.description === 'string' ? args.description : undefined,
          input: args ?? null,
        });
        continue;
      }

      // Anthropic 格式：tool_result 内容块（按 tool_use_id 关联到 tool_use）。
      if (TOOL_RESULT_BLOCK_TYPES.includes(blockType)) {
        const id = r.tool_use_id ?? r.toolUseId ?? r.toolCallId ?? r.id;
        const key = String(id || nextKey());
        const previous = byId.get(key);
        const isError = r.is_error === true || r.isError === true;
        const resultText = contentText(r.content);
        byId.set(key, {
          toolCallId: previous?.toolCallId ?? (typeof id === 'string' ? String(id) : undefined),
          name: previous?.name ?? 'unknown_tool',
          status: isError ? 'error' : (previous?.status ?? 'completed'),
          summary: resultText.slice(0, 300) || previous?.summary,
          command: previous?.command,
          description: previous?.description,
          input: previous?.input,
        });
      }
    }

    // OpenAI 格式：tool_use 在消息级 tool_calls 数组里（非内容块）。
    const msgToolCalls = message.tool_calls ?? message.toolCalls;
    if (Array.isArray(msgToolCalls)) {
      for (const tc of msgToolCalls as Array<Record<string, unknown>>) {
        const id = tc.id;
        const key = String(id || nextKey());
        const fn = (tc.function ?? tc) as Record<string, unknown> | undefined;
        let args: Record<string, unknown> | undefined;
        if (fn && typeof fn.arguments === 'string') {
          try { args = JSON.parse(fn.arguments) as Record<string, unknown>; } catch { args = undefined; }
        } else {
          args = (fn?.arguments ?? fn?.input) as Record<string, unknown> | undefined;
        }
        const previous = byId.get(key);
        if (previous && previous.command !== undefined) continue; // 已由内容块 tool_use 提取，跳过
        byId.set(key, {
          toolCallId: typeof id === 'string' ? String(id) : previous?.toolCallId,
          name: String(fn?.name ?? tc.name ?? previous?.name ?? 'unknown_tool'),
          status: previous?.status ?? 'completed',
          command: args && typeof args.command === 'string' ? args.command : previous?.command,
          description: args && typeof args.description === 'string' ? args.description : previous?.description,
          input: args ?? previous?.input ?? null,
          summary: previous?.summary,
        });
      }
    }

    // OpenAI/OpenClaw 格式：role=tool 的独立 tool_result 消息（toolCallId 在消息级）。
    if (TOOL_RESULT_ROLES.includes(String(message.role).toLowerCase())) {
      const key = String(message.toolCallId || nextKey());
      const previous = byId.get(key);
      byId.set(key, {
        toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : previous?.toolCallId,
        name: String(message.toolName || message.name || previous?.name || 'unknown_tool'),
        status: message.isError === true ? 'error' : (previous?.status ?? 'completed'),
        summary: messageText(message).slice(0, 300) || previous?.summary,
        command: previous?.command,
        description: previous?.description,
        input: previous?.input,
      });
    }
  }

  return { userMessage: messageText(messages[ui]), assistantMessage: messageText(messages[ai]), tools: [...byId.values()], messageCount: messages.length };
}

/** 便捷包装：从 adapter 的 EngineHistoryResult 直接解析快照。 */
export function parseExecutionTurnFromHistory(history: EngineHistoryResult | null | undefined): ExecutionSnapshot | null {
  const messages = history && Array.isArray(history.messages) ? history.messages as Record<string, unknown>[] : [];
  return parseExecutionTurn(messages);
}
