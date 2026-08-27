import type { BridgeAiResponseFormat } from '../../../../shared/jsbridge/bridge-ai-protocol';

function runtimeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractCanonicalMessageText(payload: unknown): string {
  const message = runtimeRecord(payload);
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (Array.isArray(message.content)) {
    return message.content.map((block) => {
      const record = runtimeRecord(block);
      return typeof record?.text === 'string' ? record.text : '';
    }).join('');
  }
  return '';
}

/** OpenClaw/Claude deltas may be cumulative snapshots or incremental chunks. */
export function mergeBridgeAiStreamText(previous: string, next: string): string {
  if (!next) return previous;
  if (!previous) return next;
  return next.startsWith(previous) ? next : previous + next;
}

export function measureBridgeAiContextBytes(context: unknown): number {
  if (context === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(context), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function buildBridgeAiSystemPromptAppend(
  systemPrompt: string | undefined,
  context: unknown,
): string | undefined {
  const parts: string[] = [];
  const trimmedPrompt = systemPrompt?.trim();
  if (trimmedPrompt) parts.push(trimmedPrompt);
  if (context !== undefined) {
    parts.push(`## Bridge context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export function parseBridgeAiResponse(
  text: string,
  responseFormat: BridgeAiResponseFormat,
): { parsed?: unknown; parseError?: string } {
  if (responseFormat !== 'json') return {};
  const trimmed = text.trim();
  if (!trimmed) return { parseError: 'empty response' };

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      return { parsed: JSON.parse(candidate) };
    } catch {
      // try next candidate
    }
  }

  return { parseError: 'response is not valid JSON' };
}

export function extractAssistantTextFromHistory(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = runtimeRecord(messages[index]);
    if (String(message?.role ?? '').toLowerCase() !== 'assistant') continue;
    const text = extractCanonicalMessageText(message);
    if (text.trim()) return text;
  }
  return '';
}
