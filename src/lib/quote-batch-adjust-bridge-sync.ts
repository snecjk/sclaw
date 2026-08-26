/**
 * Batch-adjust bridge push — independent of flow_card preview diff.
 *
 * Agent 将会话侧整理好的 CLI 入参写在消息里的 `batchAdjustParams`（常为 flow_card.data）；
 * 平台解析该结构后直接推送 `batch-adjust.params-ready`，不依赖 card 快照 diff。
 */
import type { BatchAdjustParams } from '../../shared/quote-batch-adjust';
import { parseBatchAdjustParams } from '../../shared/quote-batch-adjust';
import { extractFlowCard } from '@/lib/flow-card-patch';
import { emitBatchAdjustParamsReady } from '@/lib/quote-bridge-emit';
import { resolveEmbedRuntimeIdForChatSession } from '@/lib/flow-card-preview';
import type { RawMessage } from '@/stores/chat/types';

function paramsSignature(params: BatchAdjustParams): string {
  try {
    return JSON.stringify(params);
  } catch {
    return '';
  }
}

const deliveredParamsSigsBySession = new Map<string, Set<string>>();

function deliveredParamsSigs(sessionKey: string): Set<string> {
  let set = deliveredParamsSigsBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    deliveredParamsSigsBySession.set(sessionKey, set);
  }
  return set;
}

export interface ResolvedBatchAdjustBridgePayload {
  params: BatchAdjustParams;
  previewUrl?: string;
  cardId?: string;
  phase?: string;
}

/** Latest valid batch-adjust params in the session transcript (newest assistant message wins). */
export function resolveLatestBatchAdjustBridgePayload(
  messages: RawMessage[],
): ResolvedBatchAdjustBridgePayload | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = extractFlowCard(messages[i]);
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
    };
  }
  return null;
}

/** Mark params already present in loaded history — do not re-push on session open. */
export function seedBatchAdjustParamsBridgeState(sessionKey: string, messages: RawMessage[]): void {
  for (const message of messages) {
    const card = extractFlowCard(message);
    if (!card?.data) continue;
    const params = parseBatchAdjustParams(card.data);
    if (params) {
      deliveredParamsSigs(sessionKey).add(paramsSignature(params));
    }
  }
}

/**
 * Push `batch-adjust.params-ready` when CLI-shaped params appear or change.
 * Dedupes by params JSON signature per session (not by flow_card snapshot diff).
 */
export function syncBatchAdjustParamsBridge(sessionKey: string, messages: RawMessage[]): void {
  const payload = resolveLatestBatchAdjustBridgePayload(messages);
  if (!payload) return;

  const sig = paramsSignature(payload.params);
  if (!sig || deliveredParamsSigs(sessionKey).has(sig)) return;

  const runtimeId = resolveEmbedRuntimeIdForChatSession(sessionKey);
  if (!runtimeId) return;

  deliveredParamsSigs(sessionKey).add(sig);

  emitBatchAdjustParamsReady({
    runtimeId,
    params: payload.params,
    cardId: payload.cardId,
    phase: payload.phase,
    url: payload.previewUrl ?? null,
  });
  // 应用广场 / embed：批量调价只推 params-ready，不重定向左侧业务 webview（用户已在业务页）。
}
