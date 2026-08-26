import type { FlowCardAction, FlowCardContentBlock } from '../../shared/flow-card-protocol';
import { buildVipClawQuotationUrl } from '../../shared/vip-claw-quotation-url';
import { dispatchChatSend } from '@/hooks/dispatch-chat-send';
import { openFlowCardPreview, resolveFlowCardPreviewUrl } from '@/lib/flow-card-preview';
import { openExternalUrl } from '@/lib/preview-url';
import { useComposerFlowStore } from '@/stores/composer-flow';

function readStringParam(params: Record<string, unknown> | undefined, key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveHttpUrlFromCard(
  action: FlowCardAction,
  card: FlowCardContentBlock,
  defaultKey: string,
): string | null {
  const direct = readStringParam(action.params, 'url');
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const dataKey = readStringParam(action.params, 'urlKey') ?? defaultKey;
  const fromData = card.data?.[dataKey];
  if (typeof fromData === 'string' && /^https?:\/\//i.test(fromData.trim())) {
    return fromData.trim();
  }
  return null;
}

function resolvePreviewTargetUrl(action: FlowCardAction, card: FlowCardContentBlock): string | null {
  const fromParamsOrData = resolveHttpUrlFromCard(action, card, 'previewUrl')
    ?? resolveHttpUrlFromCard(action, card, 'detailUrl');
  if (fromParamsOrData) return fromParamsOrData;
  const ossKey = readStringParam(action.params, 'ossKey')
    ?? (typeof card.data?.ossKey === 'string' ? card.data.ossKey.trim() : null);
  if (ossKey) return buildVipClawQuotationUrl(ossKey);
  return resolveFlowCardPreviewUrl(card);
}

function buildSendText(action: FlowCardAction, fallbackLabel: string | null): string | null {
  const text = readStringParam(action.params, 'text') || fallbackLabel?.trim() || null;
  if (!text) return null;
  const ossKey = readStringParam(action.params, 'ossKey');
  const scene = readStringParam(action.params, 'scene');
  const extras = [
    ossKey ? `ossKey=${ossKey}` : null,
    scene ? `scene=${scene}` : null,
  ].filter(Boolean);
  return extras.length > 0 ? `${text}\n${extras.join('\n')}` : text;
}

function sendFlowCardChatMessage(action: FlowCardAction, text: string): void {
  const skillSlugs = Array.isArray(action.params?.skillSlugs)
    ? action.params.skillSlugs.filter((slug): slug is string => typeof slug === 'string')
    : undefined;
  void dispatchChatSend({
    text,
    skillMetas: skillSlugs?.map((slug) => ({ slug, title: slug })),
  });
}

export function dispatchFlowCardAction(action: FlowCardAction, card: FlowCardContentBlock): void {
  switch (action.kind) {
    case 'composer.openFilePicker': {
      const accept = readStringParam(action.params, 'accept') ?? undefined;
      const multiple = action.params?.multiple !== false;
      // Default autoSend=true for flow_card upload — select then send immediately.
      const autoSend = action.params?.autoSend !== false;
      const sendText = readStringParam(action.params, 'sendText') ?? undefined;
      useComposerFlowStore.getState().requestFilePicker({
        accept,
        multiple,
        autoSend,
        sendText,
      });
      return;
    }
    case 'nav.openPreviewTab': {
      const url = resolvePreviewTargetUrl(action, card);
      if (!url) return;
      const title = readStringParam(action.params, 'title') ?? undefined;
      openFlowCardPreview({ url, title, mode: 'open' });
      return;
    }
    case 'nav.refreshPreview': {
      const url = resolvePreviewTargetUrl(action, card);
      if (!url) return;
      const title = readStringParam(action.params, 'title') ?? undefined;
      // Re-open deep link — never webview.reload (business SPA may have left clawQuotation).
      openFlowCardPreview({ url, title, mode: 'refresh' });
      return;
    }
    case 'nav.openExternal': {
      const url =
        resolveHttpUrlFromCard(action, card, 'downloadUrl')
        ?? resolveHttpUrlFromCard(action, card, 'ossUrl');
      if (!url) return;
      openExternalUrl(url);
      return;
    }
    case 'chat.sendMessage': {
      const text = buildSendText(action, action.label);
      if (!text) return;
      sendFlowCardChatMessage(action, text);
      return;
    }
    case 'composer.setPhaseHint': {
      const hint = readStringParam(action.params, 'hint');
      useComposerFlowStore.getState().setPhaseHint(hint);
      return;
    }
    default: {
      // Unknown kinds (e.g. model invents `quote.save`): fall back to sending the
      // button label / params.text so the click is never a silent no-op.
      const text = buildSendText(action, action.label);
      if (!text) return;
      sendFlowCardChatMessage(action, text);
    }
  }
}
