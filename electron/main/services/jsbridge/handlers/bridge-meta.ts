import type { BridgeHandlerFn } from './types';
import { isAiCapability } from '../../../../../shared/jsbridge/capabilities';
import { isBridgeAiEnabled } from '../../../../../shared/jsbridge/trust-policy';

export const handleBridgePing: BridgeHandlerFn = async () => ({
  pong: true,
  timestamp: Date.now(),
});

export const handleBridgeGetCapabilities: BridgeHandlerFn = async ({ session }) => {
  const capabilities = [...session.grantedCapabilities];
  if (isBridgeAiEnabled(session.trustPolicy)) {
    return { capabilities };
  }
  return {
    capabilities: capabilities.filter((capability) => !isAiCapability(capability)),
  };
};
