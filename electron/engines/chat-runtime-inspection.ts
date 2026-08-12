import type { EngineRuntimeInspection } from './types';

export function runtimeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function runtimeMessageAt(message: Record<string, unknown> | null): number {
  const raw = message?.timestamp ?? message?.createdAt ?? message?.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1_000 : raw;
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function hasRuntimeAssistantOutput(message: Record<string, unknown> | null): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;
  if (typeof message.text === 'string' && message.text.trim()) return true;
  return Array.isArray(message.content) && message.content.some((value) => {
    const block = runtimeRecord(value);
    return typeof block?.text === 'string' && block.text.trim().length > 0;
  });
}

export function hasPendingRuntimeToolUse(message: Record<string, unknown> | null): boolean {
  if (!message) return false;
  const stopReason = String(message.stopReason ?? message.stop_reason ?? '').toLowerCase();
  if (stopReason === 'tooluse' || stopReason === 'tool_use') return true;
  if (['end_turn', 'endturn', 'stop', 'completed'].includes(stopReason)) return false;
  if (Array.isArray(message.content)) {
    for (let index = message.content.length - 1; index >= 0; index -= 1) {
      const block = runtimeRecord(message.content[index]);
      const type = String(block?.type ?? '');
      if (type === 'tool_use' || type === 'toolCall') return true;
      if (type === 'text' && typeof block?.text === 'string' && block.text.trim()) return false;
    }
  }
  const calls = message.tool_calls ?? message.toolCalls;
  return Array.isArray(calls) && calls.length > 0;
}

export function inspectTranscript(input: {
  messages: unknown[];
  startedAt: number;
  isRunning?: boolean;
  runId?: string | null;
}): EngineRuntimeInspection {
  const { messages, startedAt } = input;
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = runtimeRecord(messages[index]);
    if (String(message?.role ?? '').toLowerCase() !== 'user') continue;
    const occurredAt = runtimeMessageAt(message);
    if (occurredAt > 0 && occurredAt < startedAt - 2_000) break;
    userIndex = index;
    break;
  }
  const currentTurnMessages = userIndex < 0 ? [] : messages.slice(userIndex);
  const assistant = [...currentTurnMessages.slice(1)].reverse().map(runtimeRecord).find((message) => (
    String(message?.role ?? '').toLowerCase() === 'assistant'
  ));
  const transcriptRevision = JSON.stringify(currentTurnMessages);
  if (input.isRunning === true) return { status: 'active', runId: input.runId ?? undefined, currentTurnMessages, transcriptRevision };
  if (assistant && hasRuntimeAssistantOutput(assistant) && !hasPendingRuntimeToolUse(assistant)) {
    return { status: 'completed', runId: input.runId ?? undefined, currentTurnMessages, transcriptRevision };
  }
  return { status: 'unknown', runId: input.runId ?? undefined, currentTurnMessages, transcriptRevision };
}
