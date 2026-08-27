/**
 * Batch-adjust bridge push — independent of flow_card preview / params-content diff.
 *
 * Agent 将会话侧整理好的 CLI 入参写在消息里的 `batchAdjustParams`（常为 flow_card.data）；
 * 平台解析该结构后直接推送 `batch-adjust.params-ready`。
 * 按「产出该参数的助手消息」去重：同一条消息重复 sync 不推；新消息即使参数完全相同也再推
 * （覆盖用户「原样再推一次」）。
 */
import type { BatchAdjustParams } from '../../shared/quote-batch-adjust';
import { parseBatchAdjustParams } from '../../shared/quote-batch-adjust';
import { extractFlowCard } from '@/lib/flow-card-patch';
import { emitBatchAdjustParamsReady } from '@/lib/quote-bridge-emit';
import { resolveEmbedRuntimeIdForChatSession } from '@/lib/flow-card-preview';
import type { RawMessage } from '@/stores/chat/types';

const deliveredSourceKeysBySession = new Map<string, Set<string>>();

function deliveredSourceKeys(sessionKey: string): Set<string> {
  let set = deliveredSourceKeysBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    deliveredSourceKeysBySession.set(sessionKey, set);
  }
  return set;
}

function sourceMessageKey(message: RawMessage, index: number): string {
  const id = message.id?.trim();
  return id || `idx:${index}`;
}

export interface ResolvedBatchAdjustBridgePayload {
  params: BatchAdjustParams;
  previewUrl?: string;
  cardId?: string;
  phase?: string;
  sourceMessageId: string;
}

/** Latest valid batch-adjust params in the session transcript (newest assistant message wins). */
export function resolveLatestBatchAdjustBridgePayload(
  messages: RawMessage[],
): ResolvedBatchAdjustBridgePayload | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const card = extractFlowCard(message);
    if (!card?.data) continue;
    const params = parseBatchAdjustParams(card.data);
    if (!params) continue;
    const previewUrl = typeof card.data.previewUrl === 'string'
      ? card.data.previewUrl.trim()
      : undefined;
    return {
      params,
      previewUrl: previewUrl || undefined,
      cardId: card.cardId,
      phase: card.phase,
      sourceMessageId: sourceMessageKey(message, i),
    };
  }
  return null;
}

/** Mark messages already present in loaded history — do not re-push on session open. */
export function seedBatchAdjustParamsBridgeState(sessionKey: string, messages: RawMessage[]): void {
  const delivered = deliveredSourceKeys(sessionKey);
  messages.forEach((message, index) => {
    const card = extractFlowCard(message);
    if (!card?.data) return;
    const params = parseBatchAdjustParams(card.data);
    if (params) delivered.add(sourceMessageKey(message, index));
  });
}

/**
 * Push `batch-adjust.params-ready` when a new assistant message carries valid CLI params.
 * Dedupes by source message identity — identical params in a new turn still emit.
 */
export function syncBatchAdjustParamsBridge(sessionKey: string, messages: RawMessage[]): void {
  const payload = resolveLatestBatchAdjustBridgePayload(messages);
  if (!payload) return;
  if (deliveredSourceKeys(sessionKey).has(payload.sourceMessageId)) return;

  const runtimeId = resolveEmbedRuntimeIdForChatSession(sessionKey);
  if (!runtimeId) return;

  deliveredSourceKeys(sessionKey).add(payload.sourceMessageId);

  emitBatchAdjustParamsReady({
    runtimeId,
    params: payload.params,
    cardId: payload.cardId,
    phase: payload.phase,
    url: payload.previewUrl ?? null,
    sourceMessageId: payload.sourceMessageId,
  });
  // 应用广场 / embed：批量调价只推 params-ready，不重定向左侧业务 webview（用户已在业务页）。
}
