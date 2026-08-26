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

/** Short validation status lines that belong in flow_card, not as a separate bubble. */
export function isFlowCardCompanionText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(校验通过|校验未通过|校验失败|正在校验|已完成)[!.。…\s]*$/u.test(trimmed)) return true;
  if (/^报价对象\s+.+\s+校验(通过|未通过)[。.]?$/u.test(trimmed)) return true;
  return false;
}

export function stripFlowCardCompanionText(text: string): string {
  if (!text.trim()) return text;
  const kept = text
    .split('\n')
    .filter((line) => !isFlowCardCompanionText(line))
    .join('\n')
    .trim();
  return kept;
}

/** True when a ```flow_card fence has started but not yet closed (streaming). */
export function hasOpenFlowCardFence(text: string): boolean {
  if (!/```flow_card\b/i.test(text)) return false;
  FLOW_CARD_FENCE_REGEX.lastIndex = 0;
  const closed = FLOW_CARD_FENCE_REGEX.test(text);
  FLOW_CARD_FENCE_REGEX.lastIndex = 0;
  return !closed;
}

function tryParsePartialFlowCardPayload(raw: string): FlowCardPayload | null {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return null;

  let slice = raw.slice(jsonStart).replace(/```\s*$/, '').trim();
  for (let attempt = 0; attempt < 40 && slice.length > 1; attempt += 1) {
    const payload = parseFlowCardPayload(tryParseJsonObject(slice));
    if (payload) return payload;

    slice = slice
      .replace(/,\s*"[^"]*"\s*:\s*("[^"]*)?$/, '')
      .replace(/,\s*"[^"]*"\s*:\s*\{[^}]*$/, '')
      .replace(/,\s*"[^"]*"\s*:\s*\[[^\]]*$/, '')
      .replace(/,\s*$/, '');
    if (!slice.endsWith('}')) slice = `${slice}}`;
  }
  return null;
}

function extractMinimalStreamingFlowCardPayload(raw: string): FlowCardPayload | null {
  const cardId = raw.match(/"cardId"\s*:\s*"([^"\\]+)"/)?.[1]?.trim();
  const phase = raw.match(/"phase"\s*:\s*"([^"\\]+)"/)?.[1]?.trim();
  if (!cardId || !phase) return null;

  const payload: FlowCardPayload = { cardId, phase };
  const domain = raw.match(/"domain"\s*:\s*"([^"\\]+)"/)?.[1]?.trim();
  if (domain) payload.domain = domain;
  const title = raw.match(/"title"\s*:\s*"([^"]*)"/)?.[1];
  if (title) payload.title = title;
  return payload;
}

/**
 * Parse flow_card during streaming — complete fence first, then partial JSON inside an open fence.
 */
export function findStreamingFlowCardInText(text: string): FlowCardPayload | null {
  const complete = findFlowCardInText(text);
  if (complete) return complete;
  if (!hasOpenFlowCardFence(text)) return null;

  const openMatch = text.match(/```flow_card\s*\r?\n?([\s\S]*)$/i);
  const inner = openMatch?.[1]?.trim();
  if (!inner) return null;

  return tryParsePartialFlowCardPayload(inner) ?? extractMinimalStreamingFlowCardPayload(inner);
}

export function stripFlowCardFences(text: string): string {
  const hadFence = /```flow_card\b/i.test(text);
  const withoutFences = text
    .replace(/```flow_card\s*\r?\n?([\s\S]*?)```/gi, '')
    // Incomplete streaming fence: drop from opener to end
    .replace(/```flow_card\b[\s\S]*$/i, '');

  const stripped = stripBareFlowCardJson(stripGenericJsonFenceIfFlowCard(withoutFences)).trim();
  if (!stripped) return '';
  return hadFence ? stripFlowCardCompanionText(stripped) : stripped;
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

/** Like findFlowCardFenceInMessage but tolerates incomplete streaming fences. */
export function findStreamingFlowCardInMessage(content: unknown): FlowCardPayload | null {
  const complete = findFlowCardFenceInMessage(content);
  if (complete) return complete;

  if (typeof content === 'string') {
    return findStreamingFlowCardInText(content);
  }
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block
      && typeof block === 'object'
      && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: string }).text === 'string'
    ) {
      const parsed = findStreamingFlowCardInText((block as { text: string }).text);
      if (parsed) return parsed;
    }
  }
  return null;
}
