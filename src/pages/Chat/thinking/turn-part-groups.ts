/**
 * TurnPart 分组 — 连续 process 类 part 合并（Phase 2 / UI 分组规则 §6）
 */
import type { TurnPart, TurnProcessGroup } from '@/pages/Chat/thinking/turn-parts';

const PROCESS_KINDS = new Set<TurnPart['kind']>([
  'process_text',
  'reasoning',
  'tool_call',
  'tool_result',
  'waiting',
]);

const GROUP_BREAK_KINDS = new Set<TurnPart['kind']>([
  'final_text',
  'workflow_card',
  'confirmed_params',
  'artifact',
  'error',
  'interrupted',
]);

function isProcessPart(part: TurnPart): boolean {
  return PROCESS_KINDS.has(part.kind);
}

/** 将 TurnPart[] 切成 process group + 独立打断块 */
export function groupTurnParts(parts: TurnPart[]): Array<TurnProcessGroup | TurnPart> {
  const result: Array<TurnProcessGroup | TurnPart> = [];
  let buffer: TurnPart[] = [];
  let groupIndex = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const toolCallCount = buffer.filter((part) => part.kind === 'tool_call').length;
    const reasoningCount = buffer.filter(
      (part) => part.kind === 'reasoning' || part.kind === 'process_text',
    ).length;
    result.push({
      key: `process-group-${groupIndex}`,
      parts: buffer,
      toolCallCount,
      reasoningCount,
    });
    groupIndex += 1;
    buffer = [];
  };

  for (const part of parts) {
    if (GROUP_BREAK_KINDS.has(part.kind)) {
      flush();
      result.push(part);
      continue;
    }
    if (isProcessPart(part)) {
      buffer.push(part);
      continue;
    }
    flush();
    result.push(part);
  }

  flush();
  return result;
}
