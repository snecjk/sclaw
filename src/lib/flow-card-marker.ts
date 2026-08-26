import type { FlowCardPayload } from '../../shared/flow-card-protocol';

/**
 * Match ```flow_card ... ``` fences.
 * Tolerates missing newline before closing fence (common model output).
 */
export const FLOW_CARD_FENCE_REGEX = /```flow_card\s*\r?\n?([\s\S]*?)```/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseFlowCardPayload(raw: unknown): FlowCardPayload | null {
  if (!isRecord(raw)) return null;
  const cardId = typeof raw.cardId === 'string' ? raw.cardId.trim() : '';
  const phase = typeof raw.phase === 'string' ? raw.phase.trim() : '';
  if (!cardId || !phase) return null;

  const payload: FlowCardPayload = { cardId, phase };

  if (typeof raw.domain === 'string' && raw.domain.trim()) {
    payload.domain = raw.domain.trim();
  }
  if (typeof raw.title === 'string') payload.title = raw.title;
  if (typeof raw.body === 'string') payload.body = raw.body;
  if (typeof raw.hint === 'string') payload.hint = raw.hint;
  if (isRecord(raw.data)) payload.data = raw.data;
  if (Array.isArray(raw.actions)) {
    payload.actions = raw.actions.filter((action) => isRecord(action)
      && typeof action.id === 'string'
      && typeof action.label === 'string'
      && typeof action.kind === 'string') as FlowCardPayload['actions'];
  }

  return payload;
}

function tryParseJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate trailing commas / smart quotes from models
    try {
      const normalized = trimmed
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }
}

export function parseFlowCardFence(text: string): FlowCardPayload | null {
  const match = text.match(FLOW_CARD_FENCE_REGEX);
  if (!match?.[1]) return null;
  return parseFlowCardPayload(tryParseJsonObject(match[1]));
}

export function stripFlowCardFences(text: string): string {
  return text
    .replace(/```flow_card\s*\r?\n?([\s\S]*?)```/gi, '')
    // Incomplete streaming fence: drop from opener to end
    .replace(/```flow_card\b[\s\S]*$/i, '')
    .trim();
}

export function findFlowCardFenceInMessage(content: unknown): FlowCardPayload | null {
  if (typeof content === 'string') {
    return parseFlowCardFence(content);
  }
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block
      && typeof block === 'object'
      && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: string }).text === 'string'
    ) {
      const parsed = parseFlowCardFence((block as { text: string }).text);
      if (parsed) return parsed;
    }
  }
  return null;
}
