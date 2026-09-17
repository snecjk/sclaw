/**
 * iLink client v1 — re-export of vendor API used by the Worker transport.
 */

export {
  getUpdates,
  sendMessage,
  sendTyping,
  getConfig,
  notifyStart,
  notifyStop,
  classifyFetchError,
  type WeixinApiOptions,
} from "../vendor/openclaw-weixin-main/src/api/api.js";

export {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  type GetUpdatesResp,
  type SendMessageReq,
  type SendMessageResp,
  type SendTypingReq,
} from "../vendor/openclaw-weixin-main/src/api/types.js";
