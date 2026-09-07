/**
 * 一轮 run 为什么断了。进快照 / 续跑提示，不进内存临时 Map。
 *
 * 四种常见误判都长在「原因只有一句 error 字符串」上：用户停止被当成故障重试，
 * 流关闭被当成权限问题，空转防护被当成工具坏了。
 */

export const CHAT_RUN_INTERRUPT_CAUSES = [
  'user_abort',
  'stream_closed',
  'tool_timeout',
  'loop_guard_blocked',
  'hard_deadline',
  'process_restart',
  'unknown',
] as const;

export type ChatRunInterruptCause = (typeof CHAT_RUN_INTERRUPT_CAUSES)[number];

export function isChatRunInterruptCause(value: unknown): value is ChatRunInterruptCause {
  return typeof value === 'string' && (CHAT_RUN_INTERRUPT_CAUSES as readonly string[]).includes(value);
}

export function classifyChatRunInterrupt(error: unknown): ChatRunInterruptCause {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (!text) return 'unknown';
  if (/loop_guard|空转防护|repeated tool/i.test(text)) return 'loop_guard_blocked';
  if (/timeout|超时/i.test(text) && /tool|command|浏览器|bridge|automation/i.test(text)) {
    return 'tool_timeout';
  }
  if (/iterator_eof|stream|STREAM_CLOSE|aborted|AbortError|socket hang up/i.test(text)) {
    return 'stream_closed';
  }
  if (/deadline|hard.?deadline/i.test(text)) return 'hard_deadline';
  return 'unknown';
}

/**
 * 新一轮 dispatch 时从上一轮快照继承原因。completed 不继承。
 * 读当前 latest 会读到新 run（cause 为 null），所以必须在 begin 时拷过去。
 */
export function inheritChatRunInterruptCause(
  prior: {
    phase: string;
    interruptCause?: ChatRunInterruptCause | null;
    error?: string | null;
  } | null | undefined,
): ChatRunInterruptCause | null {
  if (!prior) return null;
  if (prior.phase === 'completed') return null;
  if (prior.interruptCause) return prior.interruptCause;
  if (prior.phase === 'aborted') return 'user_abort';
  if (prior.phase === 'failed') return classifyChatRunInterrupt(prior.error);
  if (prior.phase === 'interrupted') return 'unknown';
  if (prior.phase === 'reconciling') return 'process_restart';
  return null;
}
