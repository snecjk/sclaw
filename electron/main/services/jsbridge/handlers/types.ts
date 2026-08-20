import type { BridgeRequest, BridgeResponse } from '../../../../shared/jsbridge/protocol';
import type { BridgeSession } from '../session-registry';

export type BridgeHandler = (
  session: BridgeSession,
  request: BridgeRequest,
) => Promise<BridgeResponse['data']> | BridgeResponse['data'];

export interface BridgeHandlerContext {
  session: BridgeSession;
  request: BridgeRequest;
}

export type BridgeHandlerFn = (ctx: BridgeHandlerContext) => Promise<unknown>;
