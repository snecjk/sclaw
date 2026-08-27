import { createHostActionEnvelope, type JsBridgeChatTarget } from '../../../../../shared/jsbridge/host-actions';
import {
  bridgeComposerFillPlainText,
  normalizeBridgeComposerFillInput,
} from '../../../../../shared/jsbridge/composer-fill-segments';
import type { BridgeHandlerFn } from './types';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTarget(value: unknown): JsBridgeChatTarget {
  if (value === 'embed' || value === 'main' || value === 'auto') return value;
  return 'auto';
}

function parseComposerFill(params: { text?: unknown; segments?: unknown } | undefined) {
  return normalizeBridgeComposerFillInput({
    text: params?.text,
    segments: params?.segments,
  });
}

export const handleChatFillComposer: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as {
    text?: string;
    segments?: unknown;
    target?: JsBridgeChatTarget;
    send?: boolean;
    openPanel?: boolean;
  } | undefined;
  const segments = parseComposerFill(params);
  if (!segments) {
    throw Object.assign(new Error('text or segments is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'chat.fillComposer',
    text: bridgeComposerFillPlainText(segments),
    segments,
    target: parseTarget(params?.target),
    send: params?.send === true,
    openPanel: params?.openPanel !== false,
    runtimeId: session.runtimeId,
  });
};

export const handleChatOpenSession: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as {
    target?: 'embed' | 'main';
    text?: string;
    segments?: unknown;
    send?: boolean;
    title?: string;
  } | undefined;
  const target = params?.target === 'main' ? 'main' : 'embed';
  const segments = parseComposerFill(params);
  return createHostActionEnvelope({
    type: 'chat.openSession',
    target,
    text: segments ? bridgeComposerFillPlainText(segments) : undefined,
    segments: segments ?? undefined,
    send: params?.send === true,
    title: readText(params?.title) || undefined,
    runtimeId: session.runtimeId,
  });
};

export const handleChatSendMessage: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as {
    text?: string;
    segments?: unknown;
    target?: JsBridgeChatTarget;
    openPanel?: boolean;
  } | undefined;
  const segments = parseComposerFill(params);
  if (!segments) {
    throw Object.assign(new Error('text or segments is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'chat.fillComposer',
    text: bridgeComposerFillPlainText(segments),
    segments,
    target: parseTarget(params?.target),
    send: true,
    openPanel: params?.openPanel !== false,
    runtimeId: session.runtimeId,
  });
};
