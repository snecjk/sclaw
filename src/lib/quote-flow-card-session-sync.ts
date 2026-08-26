import type { FlowCardContentBlock } from '../../shared/flow-card-protocol';
import type { QuoteBridgeNotifyKind } from '../../shared/quote-bridge-channels';
import {
  parseBatchAdjustDraft,
  parseBatchAdjustParams,
  parseBatchAdjustValidation,
} from '../../shared/quote-batch-adjust';
import {
  extractFlowCard,
  findMessageIndexByFlowCardId,
  getActiveFlowCardId,
} from '@/lib/flow-card-patch';
import { syncFlowCardPreview } from '@/lib/flow-card-preview';
import type { RawMessage } from '@/stores/chat/types';

export interface FlowCardPreviewSyncSnapshot {
  ossKey: string;
  previewUrl: string;
  previewMode: string;
  phase: string;
  batchParamsSig: string;
  batchValidationSig: string;
  batchDraftSig: string;
}

const lastSnapshotByKey = new Map<string, FlowCardPreviewSyncSnapshot>();
const openedOssKeysBySession = new Map<string, Set<string>>();
const openedPreviewUrlsBySession = new Map<string, Set<string>>();

function fieldSignature(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function snapshotKey(sessionKey: string, cardId: string): string {
  return `${sessionKey}:${cardId}`;
}

function openedOssKeys(sessionKey: string): Set<string> {
  let set = openedOssKeysBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    openedOssKeysBySession.set(sessionKey, set);
  }
  return set;
}

function openedPreviewUrls(sessionKey: string): Set<string> {
  let set = openedPreviewUrlsBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    openedPreviewUrlsBySession.set(sessionKey, set);
  }
  return set;
}

export function readFlowCardPreviewSyncSnapshot(
  sessionKey: string,
  cardId: string,
): FlowCardPreviewSyncSnapshot | null {
  return lastSnapshotByKey.get(snapshotKey(sessionKey, cardId)) ?? null;
}

export function writeFlowCardPreviewSyncSnapshot(
  sessionKey: string,
  cardId: string,
  snapshot: FlowCardPreviewSyncSnapshot,
): void {
  lastSnapshotByKey.set(snapshotKey(sessionKey, cardId), snapshot);
}

export function buildFlowCardPreviewSyncSnapshot(
  card: FlowCardContentBlock,
): FlowCardPreviewSyncSnapshot {
  const ossKey = typeof card.data?.ossKey === 'string' ? card.data.ossKey.trim() : '';
  const previewUrl = typeof card.data?.previewUrl === 'string' ? card.data.previewUrl.trim() : '';
  const previewMode = typeof card.data?.previewMode === 'string' ? card.data.previewMode.trim() : '';
  const data = card.data ?? {};
  const batchValidation = parseBatchAdjustValidation(data);
  return {
    ossKey,
    previewUrl,
    previewMode,
    phase: card.phase,
    batchParamsSig: fieldSignature(parseBatchAdjustParams(data)),
    batchValidationSig: batchValidation ? fieldSignature(batchValidation) : '',
    batchDraftSig: fieldSignature(parseBatchAdjustDraft(data)),
  };
}

/** Mark targets already present in loaded history — do not auto-navigate on session open. */
export function seedQuoteFlowCardSessionState(sessionKey: string, messages: RawMessage[]): void {
  const ossKeys = openedOssKeys(sessionKey);
  const previewUrls = openedPreviewUrls(sessionKey);

  for (const message of messages) {
    const card = extractFlowCard(message);
    if (!card?.data) continue;
    const ossKey = typeof card.data.ossKey === 'string' ? card.data.ossKey.trim() : '';
    const previewUrl = typeof card.data.previewUrl === 'string' ? card.data.previewUrl.trim() : '';
    if (ossKey) ossKeys.add(ossKey);
    if (previewUrl) previewUrls.add(previewUrl);
  }

  const card = resolveActiveQuoteFlowCard(sessionKey, messages);
  if (card) {
    writeFlowCardPreviewSyncSnapshot(sessionKey, card.cardId, buildFlowCardPreviewSyncSnapshot(card));
  }
}

export function resolveActiveQuoteFlowCard(
  sessionKey: string,
  messages: RawMessage[],
): FlowCardContentBlock | null {
  const activeId = getActiveFlowCardId(sessionKey);
  if (activeId) {
    const index = findMessageIndexByFlowCardId(messages, activeId);
    if (index >= 0) return extractFlowCard(messages[index]);
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const card = extractFlowCard(messages[i]);
    if (card) return card;
  }
  return null;
}

export function computeFlowCardPreviewNotifies(input: {
  card: FlowCardContentBlock;
  prev: FlowCardPreviewSyncSnapshot | null;
  current: FlowCardPreviewSyncSnapshot;
}): QuoteBridgeNotifyKind[] {
  const { card, prev, current } = input;
  const data = card.data ?? {};
  const batchValidation = parseBatchAdjustValidation(data);

  if (card.phase === 'awaiting_upload') return [];

  if (!prev) {
    return [];
  }

  const notifies: QuoteBridgeNotifyKind[] = [];

  if (prev.ossKey !== current.ossKey && current.ossKey) {
    notifies.push('preview');
  }
  if (prev.previewUrl !== current.previewUrl && current.previewUrl) {
    notifies.push('preview');
  }
  if (prev.batchParamsSig !== current.batchParamsSig && current.batchParamsSig) {
    notifies.push('batch-adjust-params');
  }
  if (
    prev.batchValidationSig !== current.batchValidationSig
    && batchValidation
    && !batchValidation.pass
  ) {
    notifies.push('batch-adjust-validate-fail');
  }
  if (prev.batchDraftSig !== current.batchDraftSig && current.batchDraftSig) {
    notifies.push('batch-adjust-draft');
  }

  const submitSuccess =
    (card.phase === 'submitted' || card.phase === 'editing')
    && current.previewMode === 'refresh'
    && (prev.phase !== card.phase || prev.previewMode !== 'refresh');
  if (submitSuccess) {
    notifies.push('save');
  }

  return notifies;
}

function markPreviewTargetOpened(sessionKey: string, card: FlowCardContentBlock): void {
  const ossKey = typeof card.data?.ossKey === 'string' ? card.data.ossKey.trim() : '';
  const previewUrl = typeof card.data?.previewUrl === 'string' ? card.data.previewUrl.trim() : '';
  if (ossKey) openedOssKeys(sessionKey).add(ossKey);
  if (previewUrl) openedPreviewUrls(sessionKey).add(previewUrl);
}

/** First navigation for this ossKey / previewUrl in the session (upload done, before validate). */
export function shouldNavigateQuoteFlowCardPreview(
  sessionKey: string,
  card: FlowCardContentBlock,
): boolean {
  const ossKey = typeof card.data?.ossKey === 'string' ? card.data.ossKey.trim() : '';
  if (ossKey && !openedOssKeys(sessionKey).has(ossKey)) return true;
  const previewUrl = typeof card.data?.previewUrl === 'string' ? card.data.previewUrl.trim() : '';
  if (previewUrl && !openedPreviewUrls(sessionKey).has(previewUrl)) return true;
  return false;
}

function dispatchFlowCardNotify(
  sessionKey: string,
  card: FlowCardContentBlock,
  notify: QuoteBridgeNotifyKind,
): void {
  if (notify === 'preview') {
    const navigate = shouldNavigateQuoteFlowCardPreview(sessionKey, card);
    if (navigate) markPreviewTargetOpened(sessionKey, card);
    syncFlowCardPreview(card, sessionKey, notify, { navigate });
    return;
  }
  if (notify === 'save') {
    const refresh = card.data?.previewMode === 'refresh';
    syncFlowCardPreview(card, sessionKey, notify, { navigate: refresh });
    return;
  }
  syncFlowCardPreview(card, sessionKey, notify, { navigate: false });
}

/** Session-level quote flow_card bridge + one-time preview open (not in FlowCard render). */
export function syncQuoteFlowCardSession(sessionKey: string, messages: RawMessage[]): void {
  const card = resolveActiveQuoteFlowCard(sessionKey, messages);
  if (!card) return;

  const current = buildFlowCardPreviewSyncSnapshot(card);
  if (card.phase === 'awaiting_upload') {
    writeFlowCardPreviewSyncSnapshot(sessionKey, card.cardId, current);
    return;
  }

  const prev = readFlowCardPreviewSyncSnapshot(sessionKey, card.cardId);
  const notifies = computeFlowCardPreviewNotifies({ card, prev, current });
  writeFlowCardPreviewSyncSnapshot(sessionKey, card.cardId, current);

  for (const notify of notifies) {
    dispatchFlowCardNotify(sessionKey, card, notify);
  }
}
