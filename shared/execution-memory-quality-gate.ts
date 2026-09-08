import type { ChatRunInterruptCause } from './chat-run-interrupt';

export type ExecutionMemoryAvoidPathItem = {
  command?: string;
  reason?: string;
};

export type ExecutionMemoryQualityGateInput = {
  terminalStatus?: string | null;
  interruptCause?: ChatRunInterruptCause | null;
  sessionStaleHealThisTurn?: boolean;
  avoidPath?: ExecutionMemoryAvoidPathItem[] | null;
};

export type ExecutionMemoryQualityGateResult =
  | { reject: true; reason: string }
  | { reject: false };

const TOOLISH_COMMAND = /\b((?:mcp__[\w-]+__)?(?:bridge|ba)_[a-z0-9_]+|[A-Z][A-Za-z0-9]+)\b/;
const CAPABILITY_NEGATION = /避免|不要使用|不可用|权限不足|permission|not available|do not use|don't use/i;

export function avoidPathIsOneShotToolCapabilityNegation(
  avoidPath?: ExecutionMemoryAvoidPathItem[] | null,
): boolean {
  if (!avoidPath?.length) return false;
  return avoidPath.some((item) => {
    const command = item.command?.trim() ?? '';
    const reason = item.reason?.trim() ?? '';
    if (!command && !reason) return false;
    const blob = `${command} ${reason}`;
    return TOOLISH_COMMAND.test(command || reason) && CAPABILITY_NEGATION.test(blob);
  });
}

export function turnHadSessionStaleHeal(tools: unknown): boolean {
  if (!Array.isArray(tools) || tools.length === 0) return false;
  try {
    return JSON.stringify(tools).includes('SESSION_STALE');
  } catch {
    return false;
  }
}

/**
 * 失败 / 空转防护 / 会话自愈 / 单次失败得出的「避免某工具」不得沉淀为执行经验。
 */
export function rejectExecutionMemoryPersist(
  input: ExecutionMemoryQualityGateInput,
): ExecutionMemoryQualityGateResult {
  if (
    input.terminalStatus === 'failed'
    || input.terminalStatus === 'aborted'
    || input.terminalStatus === 'interrupted'
  ) {
    return { reject: true, reason: 'run_not_successful' };
  }
  if (input.interruptCause === 'loop_guard_blocked') {
    return { reject: true, reason: 'loop_guard_blocked' };
  }
  if (input.sessionStaleHealThisTurn) {
    return { reject: true, reason: 'session_stale_heal' };
  }
  if (avoidPathIsOneShotToolCapabilityNegation(input.avoidPath)) {
    return { reject: true, reason: 'one_shot_tool_capability_negation' };
  }
  return { reject: false };
}
