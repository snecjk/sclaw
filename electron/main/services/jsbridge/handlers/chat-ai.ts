import type { BridgeHandlerFn } from './types';
import { cancelBridgeAiInvocation, completeBridgeAiInvocation } from '../bridge-ai-service';
import type { ChatCancelParams, ChatCompleteParams } from '../../../../../shared/jsbridge/bridge-ai-protocol';

export const handleChatComplete: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as ChatCompleteParams | undefined;
  return completeBridgeAiInvocation(session, params ?? {});
};

export const handleChatCancel: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as ChatCancelParams | undefined;
  const requestId = typeof params?.requestId === 'string' ? params.requestId.trim() : '';
  if (!requestId) {
    throw Object.assign(new Error('requestId is required'), { code: 'AI_INVALID_PARAMS' });
  }
  return cancelBridgeAiInvocation(session, requestId);
};
