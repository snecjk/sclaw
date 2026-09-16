/**
 * iLink client v1 — thin re-export of vendor API (no Gateway plugin lifecycle).
 *
 * Thin-path constraint: do NOT import process-message / outbound-hooks / pairing
 * consumers / channel.ts from here. Only api (+ types used by api).
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
