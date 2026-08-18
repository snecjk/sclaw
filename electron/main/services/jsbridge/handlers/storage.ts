import {
  bridgeStorageClear,
  bridgeStorageGet,
  bridgeStorageRemove,
  bridgeStorageSet,
} from '../bridge-storage';
import type { BridgeHandlerFn } from './types';

function storageCtx(session: Parameters<BridgeHandlerFn>[0]['session']) {
  return {
    appId: session.trustPolicy.appId,
    sessionId: session.sessionId,
    untrusted: session.trustPolicy.trustTier === 'untrusted',
  };
}

export const handleStorageGet: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { key?: string } | undefined;
  const key = typeof params?.key === 'string' ? params.key.trim() : '';
  if (!key) throw Object.assign(new Error('key is required'), { code: 'INVALID_PARAMS' });
  return { value: bridgeStorageGet({ ...storageCtx(session), key }) };
};

export const handleStorageSet: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { key?: string; value?: unknown } | undefined;
  const key = typeof params?.key === 'string' ? params.key.trim() : '';
  if (!key) throw Object.assign(new Error('key is required'), { code: 'INVALID_PARAMS' });
  bridgeStorageSet({ ...storageCtx(session), key, value: params?.value });
  return { ok: true };
};

export const handleStorageRemove: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { key?: string } | undefined;
  const key = typeof params?.key === 'string' ? params.key.trim() : '';
  if (!key) throw Object.assign(new Error('key is required'), { code: 'INVALID_PARAMS' });
  bridgeStorageRemove({ ...storageCtx(session), key });
  return { ok: true };
};

export const handleStorageClear: BridgeHandlerFn = async ({ session }) => {
  bridgeStorageClear(storageCtx(session));
  return { ok: true };
};
