/**
 * Batch-adjust bridge push — driven by CLI-shaped params, not flow_card snapshot diff.
 *
 * flow_card is only the Skill/UI carrier; once `batchAdjustParams` parses successfully,
 * push `batch-adjust.params-ready` to the embed business page (deduped per session).
 */
import type { FlowCardContentBlock } from '../../shared/flow-card-protocol';
import {
  parseBatchAdjustParams,
  type BatchAdjustParams,
} from '../../shared/quote-batch-adjust';
import { extractFlowCard } from '@/lib/flow-card-patch';
import {
  markPreviewTargetOpened,
  shouldNavigateQuoteFlowCardPreview,
} from '@/lib/quote-flow-card-session-sync';
import { syncFlowCardPreview } from '@/lib/flow-card-preview';
import type { RawMessage } from '@/stores/chat/types';

const notifiedBatchParamsSigsBySession = new Map<string, Set<string>>();

function fieldSignature(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function notifiedBatchParamsSigs(sessionKey: string): Set<string> {
  let set = notifiedBatchParamsSigsBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    notifiedBatchParamsSigsBySession.set(sessionKey, set);
  }
  return set;
}

export function markBatchAdjustParamsNotified(
  sessionKey: string,
  params: BatchAdjustParams,
): void {
  notifiedBatchParamsSigs(sessionKey).add(fieldSignature(params));
}

/** Mark params from loaded history so reopening a session does not re-push. */
export function seedBatchAdjustParamsNotified(sessionKey: string, messages: RawMessage[]): void {
  for (const message of messages) {
    const card = extractFlowCard(message);
    if (!card?.data) continue;
    const params = parseBatchAdjustParams(card.data);
    if (params) markBatchAdjustParamsNotified(sessionKey, params);
  }
}

export function findLatestBatchAdjustParamsInMessages(
  messages: RawMessage[],
): { params: BatchAdjustParams; card: FlowCardContentBlock } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = extractFlowCard(messages[i]);
    if (!card?.data) continue;
    const params = parseBatchAdjustParams(card.data);
    if (params) return { params, card };
  }
  return null;
}

export function shouldPushBatchAdjustParams(
  sessionKey: string,
  params: BatchAdjustParams,
): boolean {
  return !notifiedBatchParamsSigs(sessionKey).has(fieldSignature(params));
}

/**
 * Push `batch-adjust.params-ready` when the latest message carries valid CLI params.
 * Independent of flow_card preview/ossKey diff.
 */
export function syncBatchAdjustParamsBridge(sessionKey: string, messages: RawMessage[]): void {
  const latest = findLatestBatchAdjustParamsInMessages(messages);
  if (!latest) return;
  if (!shouldPushBatchAdjustParams(sessionKey, latest.params)) return;

  markBatchAdjustParamsNotified(sessionKey, latest.params);
  const { card } = latest;
  const navigate = shouldNavigateQuoteFlowCardPreview(sessionKey, card);
  if (navigate) markPreviewTargetOpened(sessionKey, card);
  syncFlowCardPreview(card, sessionKey, 'batch-adjust-params', { navigate });
}
