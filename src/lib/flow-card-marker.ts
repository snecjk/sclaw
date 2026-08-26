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

/** Generic fenced JSON (models sometimes emit ```json instead of ```flow_card). */
const GENERIC_JSON_FENCE_REGEX = /```(?:json)?\s*\r?\n?([\s\S]*?)```/gi;

function parseFlowCardFromJsonText(raw: string): FlowCardPayload | null {
  return parseFlowCardPayload(tryParseJsonObject(raw));
}

function findFlowCardJsonStart(text: string): number {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const jsonStart = text.indexOf('{', searchFrom);
    if (jsonStart < 0) return -1;
    if (parseFlowCardFromJsonText(text.slice(jsonStart))) return jsonStart;
    searchFrom = jsonStart + 1;
  }
  return -1;
}

/** Bare JSON object after intro text, or the whole message. */
export function findBareFlowCardJsonInText(text: string): FlowCardPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const whole = parseFlowCardFromJsonText(trimmed);
  if (whole) return whole;

  const jsonStart = findFlowCardJsonStart(trimmed);
  if (jsonStart < 0) return null;
  return parseFlowCardFromJsonText(trimmed.slice(jsonStart));
}

/** Parse flow_card from fenced or bare model output. */
export function findFlowCardInText(text: string): FlowCardPayload | null {
  const fenced = parseFlowCardFence(text);
  if (fenced) return fenced;

  for (const match of text.matchAll(GENERIC_JSON_FENCE_REGEX)) {
    const parsed = parseFlowCardFromJsonText(match[1] ?? '');
    if (parsed) return parsed;
  }

  return findBareFlowCardJsonInText(text);
}

function stripGenericJsonFenceIfFlowCard(text: string): string {
  return text.replace(GENERIC_JSON_FENCE_REGEX, (full, inner: string) => (
    parseFlowCardFromJsonText(inner) ? '' : full
  ));
}

function stripBareFlowCardJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  if (parseFlowCardFromJsonText(trimmed)) return '';

  const jsonStart = findFlowCardJsonStart(text);
  if (jsonStart > 0) return text.slice(0, jsonStart).trim();

  return text;
}

export function stripFlowCardFences(text: string): string {
  const withoutFences = text
    .replace(/```flow_card\s*\r?\n?([\s\S]*?)```/gi, '')
    // Incomplete streaming fence: drop from opener to end
    .replace(/```flow_card\b[\s\S]*$/i, '');

  return stripBareFlowCardJson(stripGenericJsonFenceIfFlowCard(withoutFences)).trim();
}

export function findFlowCardFenceInMessage(content: unknown): FlowCardPayload | null {
  if (typeof content === 'string') {
    return findFlowCardInText(content);
  }
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block
      && typeof block === 'object'
      && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: string }).text === 'string'
    ) {
      const parsed = findFlowCardInText((block as { text: string }).text);
      if (parsed) return parsed;
    }
  }
  return null;
}
