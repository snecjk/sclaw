import type { FlowCardContentBlock } from '../../shared/flow-card-protocol';
import {
  QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_DRAFT_COMPLETE,
  QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_PARAMS_READY,
  QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_VALIDATE_FAIL,
  QUOTE_BRIDGE_CHANNEL_PREVIEW_OPEN,
  QUOTE_BRIDGE_CHANNEL_SAVE_COMPLETE,
  type QuoteBridgeEventPayload,
  type QuoteBridgeNotifyKind,
} from '../../shared/quote-bridge-channels';
import {
  parseBatchAdjustDraft,
  parseBatchAdjustParams,
  parseBatchAdjustValidation,
  serializeBatchAdjustObjectListJson,
  type BatchAdjustParams,
} from '../../shared/quote-batch-adjust';
import { BRIDGE_EVENT_QUOTE, emitBridgeGuestEvent } from '@/lib/jsbridge/emit-guest-event';
import type { FlowCardPreviewMode } from '@/lib/flow-card-preview';

const emittedSignatures = new Map<string, string>();

function signatureFor(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitQuoteChannel(
  runtimeId: string,
  channel: string,
  payload: Omit<QuoteBridgeEventPayload, 'channel'>,
  sourceKey?: string,
): void {
  const full: QuoteBridgeEventPayload = { channel, ...payload };
  const key = `${runtimeId}:${channel}:${payload.cardId ?? 'no-card'}:${sourceKey ?? ''}`;
  const signature = signatureFor(full);
  if (emittedSignatures.get(key) === signature) return;
  emittedSignatures.set(key, signature);
  void emitBridgeGuestEvent({
    runtimeId,
    name: BRIDGE_EVENT_QUOTE,
    eventPayload: full,
  });
}

function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function emitNotifyKind(
  notify: QuoteBridgeNotifyKind,
  card: FlowCardContentBlock,
  runtimeId: string,
  url: string | null,
  mode: FlowCardPreviewMode,
): void {
  const cardId = card.cardId.trim();
  const data = card.data ?? {};
  const base = { cardId, phase: card.phase, url };
  const ossKey = readString(data, 'ossKey');

  switch (notify) {
    case 'preview':
      emitQuoteChannel(runtimeId, QUOTE_BRIDGE_CHANNEL_PREVIEW_OPEN, {
        ...base,
        ...(ossKey ? { ossKey } : {}),
        mode,
      });
      break;
    case 'save': {
      const quoteId = readString(data, 'quoteId');
      const scene = readString(data, 'scene');
      if (!ossKey && !quoteId) return;
      emitQuoteChannel(runtimeId, QUOTE_BRIDGE_CHANNEL_SAVE_COMPLETE, {
        ...base,
        ...(ossKey ? { ossKey } : {}),
        quoteId: quoteId ?? undefined,
        detailUrl: readString(data, 'detailUrl') ?? undefined,
        ...(scene ? { scene } : {}),
      });
      break;
    }
    case 'batch-adjust-params': {
      const params = parseBatchAdjustParams(data);
      if (!params) return;
      emitQuoteChannel(runtimeId, QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_PARAMS_READY, {
        ...base,
        freightFeeType: params.freightFeeType,
        objectList: params.objectList,
        objectListJson: serializeBatchAdjustObjectListJson(params.objectList),
        summary: params.summary,
      });
      break;
    }
    case 'batch-adjust-validate-fail': {
      const validation = parseBatchAdjustValidation(data);
      if (!validation || validation.pass) return;
      emitQuoteChannel(runtimeId, QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_VALIDATE_FAIL, {
        ...base,
        ...validation,
      });
      break;
    }
    case 'batch-adjust-draft': {
      const draft = parseBatchAdjustDraft(data);
      if (!draft) return;
      emitQuoteChannel(runtimeId, QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_DRAFT_COMPLETE, {
        ...base,
        ...draft,
      });
      break;
    }
    default:
      break;
  }
}

/** Push `batch-adjust.params-ready` from parsed CLI params (not tied to flow_card / params-content diff). */
export function emitBatchAdjustParamsReady(input: {
  runtimeId: string;
  params: BatchAdjustParams;
  cardId?: string;
  phase?: string;
  url?: string | null;
  /** Distinct assistant message — identical params from a new turn still emit. */
  sourceMessageId?: string;
}): void {
  const cardId = input.cardId?.trim() || 'batch-adjust';
  const phase = input.phase?.trim() || 'batch_adjust';
  emitQuoteChannel(input.runtimeId, QUOTE_BRIDGE_CHANNEL_BATCH_ADJUST_PARAMS_READY, {
    cardId,
    phase,
    url: input.url ?? undefined,
    freightFeeType: input.params.freightFeeType,
    objectList: input.params.objectList,
    objectListJson: serializeBatchAdjustObjectListJson(input.params.objectList),
    summary: input.params.summary,
  }, input.sourceMessageId);
}

/** Push quote notifications to embed business page (`quote:event` + channel). */
export function emitQuoteFlowCardBridgeEvents(
  card: FlowCardContentBlock,
  runtimeId: string,
  url: string | null,
  mode: FlowCardPreviewMode,
  notify: QuoteBridgeNotifyKind | QuoteBridgeNotifyKind[],
): void {
  const kinds = Array.isArray(notify) ? notify : [notify];
  for (const kind of kinds) {
    emitNotifyKind(kind, card, runtimeId, url, mode);
  }
}
