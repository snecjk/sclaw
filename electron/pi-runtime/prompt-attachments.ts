import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PiPromptAttachment } from '../../shared/pi-runtime-protocol';

export interface PiPreparedImage {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface PiImageResizeResult {
  data: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

export interface PiImageProcessingApi {
  detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null>;
  convertToPng(data: string, mimeType: string): Promise<{ data: string; mimeType: string } | null>;
  resizeImage(data: Uint8Array, mimeType: string): Promise<PiImageResizeResult | null>;
  formatDimensionNote(result: PiImageResizeResult): string | undefined;
}

export interface PiAttachmentDiagnostic {
  fileName: string;
  suppliedMimeType: string;
  detectedMimeType: string | null;
  outputMimeType?: string;
  byteSize: number;
  kind: 'image' | 'file';
  wasResized?: boolean;
}

export interface PreparedPiPrompt {
  message: string;
  images: PiPreparedImage[];
  attachments: PiAttachmentDiagnostic[];
  imageCount: number;
  fileReferenceCount: number;
}

class PiAttachmentError extends Error {
  code: 'PI_ATTACHMENT_UNAVAILABLE' | 'PI_IMAGE_PROCESSING_FAILED' | 'PI_IMAGE_INPUT_UNSUPPORTED';

  constructor(
    code: PiAttachmentError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'PiAttachmentError';
    this.code = code;
  }
}

export function escapePiFileAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function buildPiMixedPrompt(message: string, fileAnchors: string[]): string {
  let anchorIndex = 0;
  const replaced = message.replace(/\[文件:\s*[^\]]*\]/g, (placeholder) => {
    const anchor = fileAnchors[anchorIndex];
    if (!anchor) return placeholder;
    anchorIndex += 1;
    return anchor;
  });
  const remaining = fileAnchors.slice(anchorIndex);
  if (remaining.length === 0) return replaced;
  return [replaced, ...remaining].filter(Boolean).join('\n');
}

function fileAnchor(filePath: string, displayName: string, body?: string): string {
  const displayNameAttribute = displayName.trim()
    ? ` display_name="${escapePiFileAttribute(displayName)}"`
    : '';
  return `<file name="${escapePiFileAttribute(filePath)}"${displayNameAttribute}>${body ?? ''}</file>`;
}

function attachmentUnavailable(attachment: PiPromptAttachment, reason: string, cause?: unknown): PiAttachmentError {
  return new PiAttachmentError(
    'PI_ATTACHMENT_UNAVAILABLE',
    `${attachment.fileName || attachment.filePath}: ${reason}`,
    { cause },
  );
}

function imageProcessingFailed(attachment: PiPromptAttachment, reason: string, cause?: unknown): PiAttachmentError {
  return new PiAttachmentError(
    'PI_IMAGE_PROCESSING_FAILED',
    `${attachment.fileName || attachment.filePath}: ${reason}`,
    { cause },
  );
}

export async function preparePiPromptAttachments(options: {
  message: string;
  media: PiPromptAttachment[];
  cwd?: string;
  modelSupportsImages: boolean;
  imageApi: PiImageProcessingApi;
}): Promise<PreparedPiPrompt> {
  const images: PiPreparedImage[] = [];
  const anchors: string[] = [];
  const diagnostics: PiAttachmentDiagnostic[] = [];

  for (const attachment of options.media) {
    if (!attachment || typeof attachment.filePath !== 'string' || !attachment.filePath.trim()) {
      throw attachmentUnavailable(attachment ?? { fileName: '', filePath: '', mimeType: '' }, 'file path is missing');
    }
    const absolutePath = options.cwd
      ? resolve(options.cwd, attachment.filePath)
      : resolve(attachment.filePath);
    let fileInfo: Awaited<ReturnType<typeof stat>>;
    try {
      fileInfo = await stat(absolutePath);
    } catch (error) {
      throw attachmentUnavailable(attachment, 'file does not exist or is not readable', error);
    }
    if (!fileInfo.isFile()) {
      throw attachmentUnavailable(attachment, 'path is not a regular file');
    }
    if (fileInfo.size === 0) {
      throw attachmentUnavailable(attachment, 'file is empty');
    }

    let detectedMimeType: string | null;
    try {
      detectedMimeType = await options.imageApi.detectSupportedImageMimeTypeFromFile(absolutePath);
    } catch (error) {
      throw attachmentUnavailable(attachment, 'file could not be inspected', error);
    }

    if (!detectedMimeType) {
      anchors.push(fileAnchor(absolutePath, attachment.fileName));
      diagnostics.push({
        fileName: attachment.fileName,
        suppliedMimeType: attachment.mimeType,
        detectedMimeType: null,
        byteSize: fileInfo.size,
        kind: 'file',
      });
      continue;
    }

    if (!options.modelSupportsImages) {
      throw new PiAttachmentError(
        'PI_IMAGE_INPUT_UNSUPPORTED',
        `the selected model cannot accept image input (${attachment.fileName || attachment.filePath})`,
      );
    }

    let imageBytes: Uint8Array;
    let imageMimeType = detectedMimeType;
    try {
      imageBytes = await readFile(absolutePath);
      if (detectedMimeType === 'image/bmp') {
        const converted = await options.imageApi.convertToPng(
          Buffer.from(imageBytes).toString('base64'),
          detectedMimeType,
        );
        if (!converted) throw new Error('Pi could not convert the image to PNG');
        imageBytes = Buffer.from(converted.data, 'base64');
        imageMimeType = converted.mimeType;
      }
      const resized = await options.imageApi.resizeImage(imageBytes, imageMimeType);
      if (!resized) throw new Error('Pi could not decode or resize the image');
      const dimensionNote = options.imageApi.formatDimensionNote(resized);
      images.push({ type: 'image', data: resized.data, mimeType: resized.mimeType });
      anchors.push(fileAnchor(absolutePath, attachment.fileName, dimensionNote));
      diagnostics.push({
        fileName: attachment.fileName,
        suppliedMimeType: attachment.mimeType,
        detectedMimeType,
        outputMimeType: resized.mimeType,
        byteSize: fileInfo.size,
        kind: 'image',
        wasResized: resized.wasResized,
      });
    } catch (error) {
      throw imageProcessingFailed(attachment, 'image conversion or resizing failed', error);
    }
  }

  return {
    message: buildPiMixedPrompt(options.message, anchors),
    images,
    attachments: diagnostics,
    imageCount: images.length,
    fileReferenceCount: anchors.length,
  };
}
