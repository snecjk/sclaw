import { createHostActionEnvelope } from '../../../../../shared/jsbridge/host-actions';
import type { BridgeHandlerFn } from './types';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const handleUiAlert: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as { title?: string; message?: string; confirmLabel?: string } | undefined;
  const message = readText(params?.message);
  if (!message) {
    throw Object.assign(new Error('message is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'ui.alert',
    title: readText(params?.title) || '提示',
    message,
    confirmLabel: readText(params?.confirmLabel) || undefined,
  });
};

export const handleUiConfirm: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  } | undefined;
  const message = readText(params?.message);
  if (!message) {
    throw Object.assign(new Error('message is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'ui.confirm',
    title: readText(params?.title) || '确认',
    message,
    confirmLabel: readText(params?.confirmLabel) || undefined,
    cancelLabel: readText(params?.cancelLabel) || undefined,
    destructive: params?.destructive === true,
  });
};

export const handleUiOpenDrawer: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { kind?: string } | undefined;
  const kind = readText(params?.kind) || 'chat';
  if (kind !== 'chat') {
    throw Object.assign(new Error(`Unsupported drawer kind: ${kind}`), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'ui.openDrawer',
    kind: 'chat',
    runtimeId: session.runtimeId,
  });
};
