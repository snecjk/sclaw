import type { BridgeHandlerFn } from './types';

export const handleAppGetInfo: BridgeHandlerFn = async ({ session }) => ({
  appId: session.trustPolicy.appId === '__untrusted__' ? null : session.trustPolicy.appId,
  trustTier: session.trustPolicy.trustTier,
  origin: session.currentOrigin,
  runtimeId: session.runtimeId,
});
