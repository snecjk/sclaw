/**
 * Thin outbound media: local file → CDN upload → sendMessage IMAGE/VIDEO/FILE.
 * Does not import vendor send-media / quote-store (OC plugin path).
 */

import path from 'node:path';
import {
  MessageItemType,
  MessageState,
  MessageType,
  sendMessage,
  type WeixinApiOptions,
} from '../transport/client-v1.js';
import {
  uploadFileAttachmentToWeixin,
  uploadFileToWeixin,
  uploadVideoToWeixin,
} from '../vendor/openclaw-weixin-main/src/cdn/upload.js';
import { getMimeFromFilename } from '../vendor/openclaw-weixin-main/src/media/mime.js';

/** Default iLink CDN base (vendor accounts.CDN_BASE_URL). */
export const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

export async function encodeAndSendMedia(input: {
  api: WeixinApiOptions;
  peerId: string;
  filePath: string;
  caption?: string;
  contextToken?: string;
  clientRequestId?: string;
  cdnBaseUrl?: string;
}): Promise<{ messageId?: string }> {
  const filePath = input.filePath.trim();
  if (!filePath) throw new Error('filePath required');
  const mime = getMimeFromFilename(filePath);
  const cdnBaseUrl = input.cdnBaseUrl?.trim() || WEIXIN_CDN_BASE_URL;
  const caption = input.caption?.trim() || '';

  let mediaItem: {
    type: number;
    image_item?: Record<string, unknown>;
    video_item?: Record<string, unknown>;
    file_item?: Record<string, unknown>;
  };

  if (mime.startsWith('video/')) {
    const uploaded = await uploadVideoToWeixin({
      filePath,
      toUserId: input.peerId,
      opts: input.api,
      cdnBaseUrl,
    });
    mediaItem = {
      type: MessageItemType.VIDEO,
      video_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
          encrypt_type: 1,
        },
        video_size: uploaded.fileSizeCiphertext,
      },
    };
  } else if (mime.startsWith('image/')) {
    const uploaded = await uploadFileToWeixin({
      filePath,
      toUserId: input.peerId,
      opts: input.api,
      cdnBaseUrl,
    });
    mediaItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    };
  } else {
    const fileName = path.basename(filePath);
    const uploaded = await uploadFileAttachmentToWeixin({
      filePath,
      fileName,
      toUserId: input.peerId,
      opts: input.api,
      cdnBaseUrl,
    });
    mediaItem = {
      type: MessageItemType.FILE,
      file_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
          encrypt_type: 1,
        },
        file_name: fileName,
        len: String(uploaded.fileSize),
      },
    };
  }

  const itemList: Array<Record<string, unknown>> = [];
  if (caption) {
    itemList.push({ type: MessageItemType.TEXT, text_item: { text: caption } });
  }
  itemList.push(mediaItem);

  if (!input.contextToken) {
    console.warn('[weixin-worker] CONTEXT_MISSING: sendMedia without contextToken');
  }

  const resp = await sendMessage({
    ...input.api,
    body: {
      msg: {
        from_user_id: '',
        to_user_id: input.peerId,
        client_id: input.clientRequestId || `stoclaw-weixin-media:${Date.now()}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: itemList,
        context_token: input.contextToken,
      },
    },
  });
  return { messageId: resp.message_id != null ? String(resp.message_id) : undefined };
}
