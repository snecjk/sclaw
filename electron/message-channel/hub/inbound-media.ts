import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { logger } from '../../utils/logger';

export type SclawMediaPartType = 'text' | 'picture' | 'audio' | 'video' | 'file';

export interface SclawMediaPart {
  type?: SclawMediaPartType | string;
  content?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
}

export interface DownloadedMediaItem {
  filePath: string;
  mimeType: string;
  fileName: string;
  type: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/zip': '.zip',
  'text/plain': '.txt',
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.json': 'application/json',
};

function defaultMimeForType(type: string): string {
  switch (type) {
    case 'picture':
      return 'image/png';
    case 'audio':
      return 'audio/ogg';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

export function resolveMimeType(part: SclawMediaPart): string {
  const typed = (part.mimeType || '').trim().toLowerCase();
  if (typed) return typed;
  const fileName = (part.fileName || '').trim().toLowerCase();
  const ext = extname(fileName);
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  return defaultMimeForType((part.type || 'file').toLowerCase());
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'file.bin';
}

function pickFileName(part: SclawMediaPart, mimeType: string, index: number): string {
  const raw = (part.fileName || '').trim();
  if (raw) return sanitizeFileName(raw);
  const type = (part.type || 'file').toLowerCase();
  const ext = EXT_BY_MIME[mimeType] || (type === 'picture' ? '.png' : type === 'audio' ? '.ogg' : type === 'video' ? '.mp4' : '.bin');
  return `${type}-${index}${ext}`;
}

/**
 * 从 Hub parts 拼给 Agent 的文本（用户原文 + 语音识别）；纯媒体可不带文案。
 */
export function composeInboundText(parts: SclawMediaPart[] | undefined, fallbackText?: string): string {
  const pieces: string[] = [];
  for (const part of parts ?? []) {
    const type = (part.type || '').toLowerCase();
    const content = (part.content || '').trim();
    if (!content) continue;
    if (type === 'text' || type === 'audio' || type === '') {
      pieces.push(content);
    }
  }
  if (pieces.length > 0) return pieces.join('\n').trim();
  return (fallbackText || '').trim();
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed status=${res.status} url=${url.slice(0, 120)}`);
  }
  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(filePath));
}

/**
 * 将 Hub 多模态 parts 下载到本机临时目录，供 sendMessageWithMedia 使用。
 */
export async function materializeInboundMedia(
  parts: SclawMediaPart[] | undefined,
  chatUid: string,
): Promise<DownloadedMediaItem[]> {
  const mediaParts = (parts ?? []).filter((p) => {
    const type = (p.type || '').toLowerCase();
    return !!p.url?.trim() && type !== 'text';
  });
  if (mediaParts.length === 0) return [];

  const dir = await mkdtemp(join(tmpdir(), `sclaw-inbound-${chatUid.slice(0, 8)}-`));
  const out: DownloadedMediaItem[] = [];

  for (let i = 0; i < mediaParts.length; i += 1) {
    const part = mediaParts[i];
    const url = part.url!.trim();
    const type = (part.type || 'file').toLowerCase();
    const mimeType = resolveMimeType(part);
    const fileName = pickFileName(part, mimeType, i + 1);
    const filePath = join(dir, fileName);
    try {
      await downloadToFile(url, filePath);
      out.push({ filePath, mimeType, fileName, type });
    } catch (error) {
      logger.warn('[SclawIngress] media download failed', {
        type,
        fileName,
        error: String(error),
        urlPreview: url.slice(0, 96),
      });
    }
  }
  return out;
}
