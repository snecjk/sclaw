import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ModelMessageAttachmentProvenance,
  ModelMessageCompositionV1,
} from '../../shared/model-message-composition';
import { isModelMessageCompositionV1 } from '../../shared/model-message-composition';
import {
  createModelMessageComposition,
  renderModelFileReference,
  renderModelSkillReference,
  renderModelWorkflowInstruction,
} from '../../shared/model-message-composition';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import { logger } from '../utils/logger';

export type NormalizedAttachmentKind = 'image' | 'file';

export type NormalizedModelContentPart =
  | { type: 'text'; text: string }
  | { type: 'attachment'; attachmentIndex: number; reference: string };

export interface NormalizedModelAttachment {
  filePath: string;
  fileName: string;
  suppliedMimeType: string;
  detectedMimeType: string | null;
  mimeType: string;
  byteSize: number;
  kind: NormalizedAttachmentKind;
  provenance?: ModelMessageAttachmentProvenance;
}

export interface NormalizedModelTurn {
  composition: ModelMessageCompositionV1;
  /** Canonical ordered semantics; adapters only add native binary payloads around these parts. */
  modelContent: NormalizedModelContentPart[];
  displayText: string;
  sourceText: string;
  modelText: string;
  supplementalText?: string;
  attachments: NormalizedModelAttachment[];
  selectedSkillSlugs: string[];
  workflows: Array<{ id: string; name: string; source?: string }>;
  hostMetadata?: {
    dingTalkMentions?: DingTalkMention[];
  };
  legacy: boolean;
}

export interface ModelMessageMediaInput {
  filePath: string;
  mimeType: string;
  fileName: string;
  provenance?: ModelMessageAttachmentProvenance;
}

function detectImageMimeType(header: Uint8Array): string | null {
  if (header.length >= 8
    && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
    && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a) {
    return 'image/png';
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }
  const ascii = Buffer.from(header).toString('ascii');
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (header.length >= 12 && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (header.length >= 2 && ascii.startsWith('BM')) return 'image/bmp';
  if (header.length >= 4
    && ((header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0x00)
      || (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00 && header[3] === 0x2a))) {
    return 'image/tiff';
  }
  return null;
}

async function inspectAttachment(input: ModelMessageMediaInput): Promise<NormalizedModelAttachment> {
  const filePath = resolve(input.filePath);
  let fileInfo: Awaited<ReturnType<typeof stat>>;
  try {
    fileInfo = await stat(filePath);
  } catch (error) {
    throw new Error(`MODEL_ATTACHMENT_UNAVAILABLE: ${input.fileName || input.filePath}: file does not exist or is not readable`, { cause: error });
  }
  if (!fileInfo.isFile()) {
    throw new Error(`MODEL_ATTACHMENT_UNAVAILABLE: ${input.fileName || input.filePath}: path is not a regular file`);
  }
  if (fileInfo.size === 0) {
    throw new Error(`MODEL_ATTACHMENT_UNAVAILABLE: ${input.fileName || input.filePath}: file is empty`);
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, 'r');
  } catch (error) {
    throw new Error(`MODEL_ATTACHMENT_UNAVAILABLE: ${input.fileName || input.filePath}: file is not readable`, { cause: error });
  }
  try {
    const header = Buffer.alloc(Math.min(32, fileInfo.size));
    await handle.read(header, 0, header.length, 0);
    const detectedMimeType = detectImageMimeType(header);
    return {
      filePath,
      fileName: input.fileName?.trim() || filePath.split(/[\\/]/).pop() || filePath,
      suppliedMimeType: input.mimeType,
      detectedMimeType,
      mimeType: detectedMimeType ?? (input.mimeType || 'application/octet-stream'),
      byteSize: fileInfo.size,
      kind: detectedMimeType ? 'image' : 'file',
      provenance: input.provenance,
    };
  } finally {
    await handle.close();
  }
}

function compactUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function extractSupplementalText(suppliedMessage: string, normalizedBody: string): string | undefined {
  if (!suppliedMessage || suppliedMessage === normalizedBody) return undefined;

  // DingTalk preprocessing wraps machine context above the original user body.
  // Composition remains the body authority; retain only the machine context.
  const wrappedUserMarker = '\n---\n\n用户消息：\n';
  const markerIndex = suppliedMessage.lastIndexOf(wrappedUserMarker);
  if (markerIndex >= 0) {
    const wrappedBody = suppliedMessage.slice(markerIndex + wrappedUserMarker.length).trim();
    if (wrappedBody === normalizedBody) {
      return suppliedMessage.slice(0, markerIndex).trim() || undefined;
    }
  }

  const bodyIndex = normalizedBody ? suppliedMessage.indexOf(normalizedBody) : -1;
  if (bodyIndex < 0) return undefined;
  return [
    suppliedMessage.slice(0, bodyIndex),
    suppliedMessage.slice(bodyIndex + normalizedBody.length),
  ].join('\n').trim() || undefined;
}

export async function normalizeModelMessage(input: {
  message: string;
  composition?: unknown;
  media?: ModelMessageMediaInput[];
}): Promise<NormalizedModelTurn> {
  const media = input.media ?? [];
  if (!isModelMessageCompositionV1(input.composition)) {
    const legacy = media.length > 0
      || /\[(?:文件|技能):|\[media attached:|\[STOCLAW:DINGTALK_RECIPIENTS|<!--\s*SClaw-Skill/i.test(input.message);
    const attachments = await Promise.all(media.map(inspectAttachment));
    return {
      composition: createModelMessageComposition([
        { type: 'text', text: input.message },
        ...media.map((item, mediaIndex) => ({
          type: 'attachment' as const,
          mediaIndex,
          displayName: item.fileName,
        })),
      ]),
      modelContent: [{ type: 'text', text: input.message }],
      displayText: input.message.trim(),
      sourceText: input.message.trim(),
      modelText: input.message,
      attachments,
      selectedSkillSlugs: [],
      workflows: [],
      legacy,
    };
  }

  const referencedIndexes = new Set<number>();
  for (const segment of input.composition.segments) {
    if (segment.type !== 'attachment') continue;
    if (!media[segment.mediaIndex]) {
      throw new Error(`MODEL_COMPOSITION_INVALID: attachment mediaIndex ${segment.mediaIndex} is unavailable`);
    }
    if (referencedIndexes.has(segment.mediaIndex)) {
      throw new Error(`MODEL_COMPOSITION_INVALID: mediaIndex ${segment.mediaIndex} is referenced more than once`);
    }
    referencedIndexes.add(segment.mediaIndex);
  }
  if (referencedIndexes.size !== media.length) {
    const unreferenced = media
      .map((_, index) => index)
      .filter((index) => !referencedIndexes.has(index));
    throw new Error(`MODEL_COMPOSITION_INVALID: media indexes are not referenced exactly once: ${unreferenced.join(', ')}`);
  }

  const inspectedByIndex = new Map<number, NormalizedModelAttachment>();
  await Promise.all([...referencedIndexes].map(async (index) => {
    try {
      inspectedByIndex.set(index, await inspectAttachment(media[index]!));
    } catch (error) {
      logger.warn('[model-message] attachment preflight failed', {
        mediaIndex: index,
        fileName: media[index]?.fileName,
        reason: String(error),
      });
      throw error;
    }
  }));

  const displayParts: string[] = [];
  const sourceParts: string[] = [];
  const modelParts: string[] = [];
  const transportComparisonParts: string[] = [];
  const orderedAttachments: NormalizedModelAttachment[] = [];
  const explicitSkillSlugs: string[] = [];
  const workflows: Array<{ id: string; name: string; source?: string }> = [];
  const modelContent: NormalizedModelContentPart[] = [];

  const appendModelText = (text: string): void => {
    if (!text) return;
    modelParts.push(text);
    const previous = modelContent[modelContent.length - 1];
    if (previous?.type === 'text') previous.text += text;
    else modelContent.push({ type: 'text', text });
  };

  for (const segment of input.composition.segments) {
    switch (segment.type) {
      case 'text':
        displayParts.push(segment.text);
        sourceParts.push(segment.text);
        appendModelText(segment.text);
        transportComparisonParts.push(segment.text);
        break;
      case 'mention': {
        const mention = `@${segment.displayName}`;
        displayParts.push(mention);
        sourceParts.push(mention);
        appendModelText(mention);
        transportComparisonParts.push(mention);
        break;
      }
      case 'attachment': {
        const attachment = inspectedByIndex.get(segment.mediaIndex)!;
        const attachmentIndex = orderedAttachments.length;
        orderedAttachments.push(attachment);
        sourceParts.push(`[文件: ${attachment.fileName}]`);
        const reference = renderModelFileReference(attachment.filePath, attachment.fileName);
        modelParts.push(reference);
        modelContent.push({ type: 'attachment', attachmentIndex, reference });
        break;
      }
      case 'skill':
        explicitSkillSlugs.push(segment.slug);
        sourceParts.push(`[技能: ${segment.title || segment.slug}]`);
        {
          const reference = renderModelSkillReference(segment.slug, segment.title);
          appendModelText(reference);
        }
        break;
      case 'workflow': {
        const instruction = renderModelWorkflowInstruction(segment.id, segment.name);
        workflows.push({ id: segment.id, name: segment.name, source: segment.source });
        sourceParts.push(instruction);
        appendModelText(instruction);
        transportComparisonParts.push(instruction);
        break;
      }
    }
  }

  const composedModelText = modelParts.join('').trim();
  const transportComparisonText = transportComparisonParts.join('').trim();
  const suppliedMessage = input.message.trim();
  const supplementalText = extractSupplementalText(suppliedMessage, transportComparisonText);
  if (suppliedMessage && suppliedMessage !== transportComparisonText && !supplementalText) {
    logger.warn('[model-message] ignored unmatched baked message; structured composition remains authoritative', {
      suppliedMessageChars: suppliedMessage.length,
      normalizedBodyChars: transportComparisonText.length,
    });
  }
  const explicitSkills = compactUnique(explicitSkillSlugs);
  const skillOnlyFallback = !composedModelText
    && !supplementalText
    && orderedAttachments.length === 0
    && explicitSkills.length > 0
    ? '请处理本次请求。'
    : '';
  const modelText = [composedModelText, supplementalText, skillOnlyFallback].filter(Boolean).join('\n\n');
  if (supplementalText) appendModelText(`${modelContent.length ? '\n\n' : ''}${supplementalText}`);
  if (skillOnlyFallback) appendModelText(`${modelContent.length ? '\n\n' : ''}${skillOnlyFallback}`);

  logger.info('[model-message] semantic.turn', {
    segmentTypes: input.composition.segments.map((segment) => segment.type),
    segmentCount: input.composition.segments.length,
    canonicalModelChars: modelText.length,
    imageCount: orderedAttachments.filter((attachment) => attachment.kind === 'image').length,
    fileReferenceCount: orderedAttachments.filter((attachment) => attachment.kind === 'file').length,
  });
  let loggedAttachmentIndex = 0;
  input.composition.segments.forEach((segment, segmentIndex) => {
    if (segment.type === 'attachment') {
      const attachment = orderedAttachments[loggedAttachmentIndex++];
      logger.info('[model-message] semantic.segment', {
        segmentIndex,
        type: segment.type,
        fileName: attachment?.fileName ?? segment.displayName,
        filePath: attachment?.filePath ?? null,
        detectedMimeType: attachment?.detectedMimeType ?? null,
        mimeType: attachment?.mimeType ?? null,
        kind: attachment?.kind ?? null,
        byteSize: attachment?.byteSize ?? null,
      });
      return;
    }
    if (segment.type === 'text') {
      logger.info('[model-message] semantic.segment', {
        segmentIndex,
        type: segment.type,
        textChars: segment.text.length,
        preview: segment.text.slice(0, 160),
      });
      return;
    }
    logger.info('[model-message] semantic.segment', { segmentIndex, ...segment });
  });

  return {
    composition: input.composition,
    modelContent,
    displayText: displayParts.join('').trim(),
    sourceText: sourceParts.join('').trim(),
    modelText,
    supplementalText,
    attachments: orderedAttachments,
    selectedSkillSlugs: explicitSkills,
    workflows,
    legacy: false,
  };
}

export function toEngineMedia(turn: NormalizedModelTurn): ModelMessageMediaInput[] {
  return turn.attachments.map((attachment) => ({
    filePath: attachment.filePath,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    provenance: attachment.provenance,
  }));
}
