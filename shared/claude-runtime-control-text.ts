/** Claude Agent SDK transcript control lines — not user-facing replies. */
import type { ChatRunInterruptCause } from './chat-run-interrupt';

const SDK_NO_VISIBLE_OUTPUT = /\[Your previous response had no visible output\. Please continue/i;

export function isClaudeRuntimeControlText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^No response requested\.?$/i.test(trimmed)) return true;
  if (/^\[Request interrupted by user for tool use\]$/i.test(trimmed)) return true;
  if (SDK_NO_VISIBLE_OUTPUT.test(trimmed)) return true;
  if (/^<local-command-caveat>[\s\S]*<\/local-command-caveat>$/i.test(trimmed)) return true;
  if (/^<command-name>[\s\S]*<\/command-name>(?:[\s\S]*<command-message>[\s\S]*<\/command-message>)?(?:[\s\S]*<command-args>[\s\S]*<\/command-args>)?$/i.test(trimmed)) return true;
  if (/^<local-command-(?:stdout|stderr)>[\s\S]*<\/local-command-(?:stdout|stderr)>$/i.test(trimmed)) return true;
  if (trimmed.startsWith('This session is being continued from a previous conversation that ran out of context.')) return true;
  return false;
}

/** Claude Agent SDK 在空 user turn 上注入的续跑句，不是用户原话。 */
const SDK_RESUME_CONTINUE_PROMPT = /^continue from where you left off\.?$/i;

/** User asks to continue after a hung / interrupted turn. */
export function isContinueUserPrompt(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SDK_RESUME_CONTINUE_PROMPT.test(trimmed)) return true;
  if (SDK_NO_VISIBLE_OUTPUT.test(trimmed)) return true;
  if (/^(继续|接着|go on|continue|resume)([。.!！]?)$/i.test(trimmed)) return true;
  return /^(请)?继续(吧|啊|分析|写)?[。.!！]?$/.test(trimmed);
}

export function inspectClaudeAssistantPayload(payload: unknown): {
  hasToolUse: boolean;
  hasVisibleText: boolean;
} {
  const blocks = extractAssistantBlocks(payload);
  let hasToolUse = false;
  let hasVisibleText = false;
  for (const block of blocks) {
    if (block.type === 'tool_use') hasToolUse = true;
    if (typeof block.text === 'string') {
      const trimmed = block.text.trim();
      if (trimmed && !isClaudeRuntimeControlText(trimmed)) hasVisibleText = true;
    }
  }
  if (blocks.length === 0 && typeof payload === 'string') {
    const trimmed = payload.trim();
    hasVisibleText = Boolean(trimmed) && !isClaudeRuntimeControlText(trimmed);
  }
  return { hasToolUse, hasVisibleText };
}

/**
 * 本轮没有对用户可见的输出：纯控制行、thinking-only、或 result 本身是控制行。
 * 有 tool_use / 可见正文 / 无 assistant 但 result 有实文 → 不算空。
 */
export function isClaudeTurnContentless(input: {
  hadAssistant: boolean;
  hadToolUse: boolean;
  hadVisibleAssistantText: boolean;
  resultText?: string;
}): boolean {
  if (input.hadToolUse || input.hadVisibleAssistantText) return false;
  const result = input.resultText?.trim() ?? '';
  if (!input.hadAssistant && result && !isClaudeRuntimeControlText(result)) {
    return false;
  }
  return true;
}

export function shouldAutoResumeContentlessTurn(input: {
  turnWasContentless: boolean;
  autoResumeCount: number;
  interruptCause: ChatRunInterruptCause | null;
  ownerRunId: string | null | undefined;
  currentRunId: string;
}): boolean {
  void input;
  // 空回合自动续跑会 startClaudeQuery('')，SDK 注入 Continue from where you left off，
  // 模型把 tool_result / 空 user turn 讲成「用户发了空消息」。零 tool_use 的首轮更会卡在读取项目上下文。
  return false;
}

function extractAssistantBlocks(payload: unknown): Array<{ type?: string; text?: string }> {
  if (typeof payload === 'string') {
    return [{ type: 'text', text: payload }];
  }
  if (!payload || typeof payload !== 'object') return [];
  const rec = payload as Record<string, unknown>;
  let content: unknown = rec.content;
  if (content === undefined && rec.message && typeof rec.message === 'object') {
    const nested = rec.message as Record<string, unknown>;
    content = nested.content ?? rec.message;
  }
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is { type?: string; text?: string } => Boolean(block) && typeof block === 'object');
}

/**
 * 替换 SDK / 空「继续」user turn。必须非空，且不能再是 Continue from where you left off.
 */
export function buildClaudeResumeContinueUserPrompt(cause: ChatRunInterruptCause | null): string {
  const detail = buildClaudeResumeInterruptAppend({
    isResume: true,
    isContinue: true,
    cause: cause ?? 'unknown',
  });
  return [
    '根据已有结果继续当前任务，不要把页面或会话重新探测一遍。',
    detail,
  ].filter(Boolean).join('\n\n');
}

/**
 * Resume starts a new SDK query. Transcript tool_result lines are not empty user
 * turns — tell the model to write from existing tools instead of re-probing.
 */
export function buildClaudeResumeInterruptAppend(input: {
  isResume: boolean;
  isContinue: boolean;
  lastError?: string;
  cause?: ChatRunInterruptCause | null;
}): string | undefined {
  if (!input.isResume) return undefined;
  if (!input.isContinue && !input.lastError && !input.cause) return undefined;
  const lines = [
    '【上一轮中断】resume 会开新的 SDK query；历史里的 tool_result 是 transcript 行，不是空的用户消息。根据已有结果继续，不要把页面重新探测一遍。',
  ];
  switch (input.cause) {
    case 'user_abort':
      lines.push('用户已停止上一轮。不要自行接着干未完成的操作，等待这条消息里的新指令。');
      break;
    case 'stream_closed':
      lines.push('上一轮是流被关闭，不是权限错误。用已有 snapshot/正文续写或执行下一步。');
      break;
    case 'tool_timeout':
      lines.push('上一轮是工具超时。缩小范围或换手段，不要用同一组参数原样重试。');
      break;
    case 'loop_guard_blocked':
      lines.push('上一轮因连续同名同参调用被拦下。必须换工具或改参数，不要再点同一个目标。');
      break;
    case 'hard_deadline':
      lines.push('上一轮到达时限。先给出目前能确定的结论，不要开新的长任务。');
      break;
    case 'process_restart':
      lines.push('应用刚从中断中恢复。根据已有 transcript 继续，不要当成全新任务重新检查会话。');
      break;
    case 'unknown':
    default:
      if (input.lastError) {
        lines.push(`上一轮中断原因：${input.lastError}`);
      }
      break;
  }
  return lines.join('\n');
}
