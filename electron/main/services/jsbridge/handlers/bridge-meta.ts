import type { BridgeHandlerFn } from './types';

export const handleBridgePing: BridgeHandlerFn = async () => ({
  pong: true,
  timestamp: Date.now(),
});

export const handleBridgeGetCapabilities: BridgeHandlerFn = async ({ session }) => ({
  capabilities: [...session.grantedCapabilities],
});
