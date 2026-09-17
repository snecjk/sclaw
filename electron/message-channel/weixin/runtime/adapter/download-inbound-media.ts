/**
 * Download/decrypt inbound Weixin media into the Host Worker state dir.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { WeixinInboundPart } from '../../../../../shared/weixin-runtime-protocol';
import { MessageItemType } from '../transport/client-v1.js';
import { resolveWeixinStateDir } from '../transport/state-dir.js';
import {
  downloadAndDecryptBuffer,
  downloadPlainCdnBuffer,
} from '../vendor/openclaw-weixin-main/src/cdn/pic-decrypt.js';
import { getMimeFromFilename } from '../vendor/openclaw-weixin-main/src/media/mime.js';
import { WEIXIN_CDN_BASE_URL } from './encode-outbound-media.js';

type RawMedia = {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
};

type RawItem = {
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: RawMedia; aeskey?: string };
  voice_item?: { media?: RawMedia; text?: string };
  file_item?: { media?: RawMedia; file_name?: string };
  video_item?: { media?: RawMedia };
};

const MAX_BYTES = 100 * 1024 * 1024;

async function saveBuffer(
  buf: Buffer,
  fileName: string,
  subdir: string,
): Promise<string> {
  if (buf.length > MAX_BYTES) {
    throw new Error(`media too large: ${buf.length} bytes`);
  }
  const dir = path.join(resolveWeixinStateDir(), 'media', subdir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const safe = fileName.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').slice(0, 120) || 'file.bin';
  const out = path.join(dir, `${Date.now()}-${safe}`);
  await fs.writeFile(out, buf, { mode: 0o600 });
  return out;
}

function hasDownloadable(media?: RawMedia): boolean {
  return Boolean(media?.encrypt_query_param || media?.full_url);
}

export async function materializeInboundParts(input: {
  itemList?: RawItem[];
  messageId: string;
  cdnBaseUrl?: string;
}): Promise<{ text?: string; parts: WeixinInboundPart[] }> {
  const cdnBaseUrl = input.cdnBaseUrl?.trim() || WEIXIN_CDN_BASE_URL;
  const parts: WeixinInboundPart[] = [];
  const textParts: string[] = [];
  const label = `inbound:${input.messageId}`;

  for (const item of input.itemList ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text?.trim()) {
      const t = item.text_item.text.trim();
      textParts.push(t);
      parts.push({ kind: 'text', text: t });
      continue;
    }

    if (item.type === MessageItemType.IMAGE && hasDownloadable(item.image_item?.media)) {
      const img = item.image_item!;
      const media = img.media!;
      try {
        const aesKeyBase64 = img.aeskey
          ? Buffer.from(img.aeskey, 'hex').toString('base64')
          : media.aes_key;
        const buf = aesKeyBase64
          ? await downloadAndDecryptBuffer(
              media.encrypt_query_param ?? '',
              aesKeyBase64,
              cdnBaseUrl,
              `${label} image`,
              media.full_url,
            )
          : await downloadPlainCdnBuffer(
              media.encrypt_query_param ?? '',
              cdnBaseUrl,
              `${label} image-plain`,
              media.full_url,
            );
        const localPath = await saveBuffer(buf, 'image.jpg', 'inbound');
        parts.push({
          kind: 'image',
          localPath,
          mimeType: 'image/jpeg',
          fileName: path.basename(localPath),
        });
      } catch (err) {
        parts.push({ kind: 'image', notice: `图片下载失败：${String(err)}` });
      }
      continue;
    }

    if (item.type === MessageItemType.FILE && hasDownloadable(item.file_item?.media) && item.file_item?.media?.aes_key) {
      const fileItem = item.file_item!;
      const media = fileItem.media!;
      const fileName = fileItem.file_name?.trim() || 'file.bin';
      try {
        const buf = await downloadAndDecryptBuffer(
          media.encrypt_query_param ?? '',
          media.aes_key!,
          cdnBaseUrl,
          `${label} file`,
          media.full_url,
        );
        const mime = getMimeFromFilename(fileName);
        const localPath = await saveBuffer(buf, fileName, 'inbound');
        parts.push({
          kind: 'file',
          localPath,
          mimeType: mime,
          fileName,
        });
      } catch (err) {
        parts.push({ kind: 'file', fileName, notice: `文件下载失败：${String(err)}` });
      }
      continue;
    }

    if (item.type === MessageItemType.VIDEO && hasDownloadable(item.video_item?.media) && item.video_item?.media?.aes_key) {
      const media = item.video_item!.media!;
      try {
        const buf = await downloadAndDecryptBuffer(
          media.encrypt_query_param ?? '',
          media.aes_key!,
          cdnBaseUrl,
          `${label} video`,
          media.full_url,
        );
        const localPath = await saveBuffer(buf, 'video.mp4', 'inbound');
        parts.push({
          kind: 'video',
          localPath,
          mimeType: 'video/mp4',
          fileName: path.basename(localPath),
        });
      } catch (err) {
        parts.push({ kind: 'video', notice: `视频下载失败：${String(err)}` });
      }
      continue;
    }

    if (item.type === MessageItemType.VOICE) {
      const transcript = item.voice_item?.text?.trim();
      if (transcript) {
        textParts.push(transcript);
        parts.push({ kind: 'voice', text: transcript, notice: '语音转写' });
      } else {
        parts.push({ kind: 'voice', notice: '[语音消息]' });
      }
      continue;
    }

    if (item.type && item.type !== MessageItemType.NONE && item.type !== MessageItemType.TEXT) {
      parts.push({ kind: 'unknown', notice: `[不支持的消息类型:${item.type}]` });
    }
  }

  const text = textParts.length ? textParts.join('\n') : undefined;
  return { text, parts };
}
