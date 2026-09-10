import type { IMSDKInterface } from '@openim/electron-client-sdk/lib/render';
import type { ConversationItem, MessageItem } from '@openim/wasm-client-sdk';
import { hostApiFetch } from '@/lib/host-api';
import {
  buildImRichPayload,
  isImRichHtmlEmpty,
  sanitizeImRichHtml,
  serializeImRichPayload,
} from './im-rich-html';
import { sendMessageToConversation } from './send-attachment';

function uuid(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function filePathFromFileUrl(src: string): string | null {
  if (!src.startsWith('file://')) return null;
  try {
    const path = decodeURIComponent(src.replace(/^file:\/\//, ''));
    // macOS file:///Users/... → /Users/...
    if (path.startsWith('/')) return path;
    return `/${path}`;
  } catch {
    return null;
  }
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Electron native uploadFile only accepts filepath (File is lost in JSON.stringify).
 * Stage blob/File bytes via existing Host API, then upload with filepath.
 */
async function materializeFileToTempPath(file: File): Promise<string> {
  const base64 = await arrayBufferToBase64(await file.arrayBuffer());
  const result = await hostApiFetch<{ stagedPath?: string; error?: string }>('/api/files/stage-buffer', {
    method: 'POST',
    body: JSON.stringify({
      base64,
      fileName: file.name || 'image.png',
      mimeType: file.type || 'image/png',
    }),
  });
  if (!result?.stagedPath) {
    throw new Error(result?.error || 'failed to stage upload file');
  }
  return result.stagedPath;
}

async function uploadLocalImage(
  im: IMSDKInterface,
  params: { file?: File; filepath?: string; name: string; contentType: string },
): Promise<string> {
  let filepath = params.filepath ?? null;
  if (!filepath && params.file) {
    filepath = await materializeFileToTempPath(params.file);
  }
  if (!filepath) {
    throw new Error('uploadFile requires filepath');
  }

  // OpenIM object key is `{userID}/{name}` — duplicate names overwrite and share one URL.
  const safeBase = (params.name || 'image.png').replace(/[^\w.\-()+]+/g, '_');
  const uniqueName = `${uuid()}-${safeBase}`;

  const response = await im.uploadFile({
    name: uniqueName,
    contentType: params.contentType,
    uuid: uuid(),
    filepath,
  });
  const url = response.data?.url;
  if (!url) {
    throw new Error('uploadFile returned empty url');
  }
  return url;
}

/**
 * Replace local/blob image sources with uploaded HTTPS URLs, then create Custom rich message.
 */
export async function prepareAndSendRichHtml(
  im: IMSDKInterface,
  conversation: ConversationItem,
  html: string,
  blobFiles: Map<string, File>,
): Promise<MessageItem | null> {
  if (isImRichHtmlEmpty(html)) return null;

  const working = sanitizeImRichHtml(html, { allowLocalImg: true });
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="__root">${working}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return null;

  const images = Array.from(root.querySelectorAll('img'));
  for (const img of images) {
    const src = img.getAttribute('src') ?? '';
    if (!src) {
      img.remove();
      continue;
    }
    if (/^https?:/i.test(src)) continue;

    if (src.startsWith('blob:')) {
      const file = blobFiles.get(src);
      if (!file) {
        img.remove();
        continue;
      }
      const url = await uploadLocalImage(im, {
        file,
        name: file.name || 'image.png',
        contentType: file.type || 'image/png',
      });
      img.setAttribute('src', url);
      continue;
    }

    if (src.startsWith('data:image/')) {
      const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        img.remove();
        continue;
      }
      const contentType = match[1];
      const ext = contentType.split('/')[1] || 'png';
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const file = new File([bytes], `image.${ext}`, { type: contentType });
      const url = await uploadLocalImage(im, {
        file,
        name: file.name,
        contentType,
      });
      img.setAttribute('src', url);
      continue;
    }

    const filepath = filePathFromFileUrl(src) ?? (src.startsWith('/') ? src : null);
    if (filepath) {
      const name = filepath.split(/[/\\]/).pop() || 'image.png';
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'png';
      const contentType = ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/png';
      const url = await uploadLocalImage(im, {
        filepath,
        name,
        contentType,
      });
      img.setAttribute('src', url);
      continue;
    }

    // Unknown local scheme — drop.
    img.remove();
  }

  const payload = buildImRichPayload(root.innerHTML);
  if (isImRichHtmlEmpty(payload.html)) return null;

  const created = await im.createCustomMessage({
    data: serializeImRichPayload(payload),
    description: payload.plainText.slice(0, 64) || '[图文]',
    extension: payload.bizType,
  });
  const message = created.data;
  if (!message) return null;

  return sendMessageToConversation(im, conversation, message);
}
