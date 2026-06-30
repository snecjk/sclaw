import {
  assertDingTalkShareOpenUrl,
  buildDingTalkShareAppLinkUrl,
  type DingTalkShareBuildResult,
  type DingTalkShareContent,
} from '../../shared/dingtalk-share';
import { uploadFileToTempOSS } from '@/lib/host-api';
import { isHttpUrl } from '@/lib/preview-url';
import type { AttachedFileMeta } from '@/stores/chat';
import {
  buildArtifactMetaLine,
  formatArtifactFileSize,
} from '@/components/chat/artifact-product-card';

export type { DingTalkShareBuildResult, DingTalkShareContent };

export type DingTalkShareDialogDraft =
  | {
      kind: 'artifact';
      title: string;
      metaLine: string;
      fileName: string;
      filePath: string;
    }
  | {
      kind: 'conversation';
      textPreview: string;
      fullText: string;
      artifact?: {
        title: string;
        metaLine: string;
        fileName: string;
        filePath: string;
      };
    };

/** @deprecated Use DingTalkShareDialogDraft */
export type ArtifactShareDraft = {
  title: string;
  text: string;
  url: string;
  isLocalServeUrl: boolean;
};

/**
 * Truncate conversation text to at most two preview lines; append ellipsis when trimmed.
 */
export function truncateConversationPreview(
  text: string,
  maxLines = 2,
  maxCharsPerLine = 52,
): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const nonEmptyLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let lines: string[];
  let truncated: boolean;

  if (nonEmptyLines.length >= 2) {
    lines = nonEmptyLines
      .slice(0, maxLines)
      .map((line) => (line.length > maxCharsPerLine ? line.slice(0, maxCharsPerLine) : line));
    truncated = nonEmptyLines.length > maxLines
      || nonEmptyLines.slice(0, maxLines).some((line) => line.length > maxCharsPerLine);
  } else {
    const flat = (nonEmptyLines[0] ?? normalized).replace(/\s+/g, ' ');
    lines = [];
    let remaining = flat;
    while (remaining.length > 0 && lines.length < maxLines) {
      if (remaining.length <= maxCharsPerLine) {
        lines.push(remaining);
        remaining = '';
        break;
      }
      lines.push(remaining.slice(0, maxCharsPerLine));
      remaining = remaining.slice(maxCharsPerLine).trimStart();
    }
    truncated = remaining.length > 0;
  }

  const preview = lines.join('\n');
  return truncated ? `${preview}...` : preview;
}

function displayArtifactTitle(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return '产物';
  return trimmed.replace(/\.[^.]+$/, '') || trimmed;
}

function pickPrimaryShareArtifact(files: AttachedFileMeta[]): AttachedFileMeta | null {
  if (!files.length) return null;
  const document = files.find(
    (file) => !file.mimeType.startsWith('image/') && file.filePath.trim().length > 0,
  );
  return document ?? files[0] ?? null;
}

function buildArtifactDraftFields(
  file: { fileName: string; filePath: string; mimeType: string; fileSize?: number },
  t: (key: string) => string,
): { title: string; metaLine: string; fileName: string; filePath: string } {
  const fileName = file.fileName.trim() || '产物';
  return {
    title: displayArtifactTitle(fileName),
    metaLine: buildArtifactMetaLine({
      fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      formatFileSize: formatArtifactFileSize,
      t,
    }),
    fileName,
    filePath: file.filePath,
  };
}

export function buildArtifactShareDialogDraft(
  file: { fileName: string; filePath: string; mimeType: string; fileSize?: number },
  t: (key: string) => string,
): DingTalkShareDialogDraft {
  return {
    kind: 'artifact',
    ...buildArtifactDraftFields(file, t),
  };
}

export function buildConversationShareDialogDraft(
  text: string,
  files: AttachedFileMeta[],
  t: (key: string) => string,
): DingTalkShareDialogDraft {
  const artifactFile = pickPrimaryShareArtifact(files);
  return {
    kind: 'conversation',
    textPreview: truncateConversationPreview(text),
    fullText: text.trim(),
    artifact: artifactFile
      ? buildArtifactDraftFields(artifactFile, t)
      : undefined,
  };
}

/**
 * Resolve shareable HTTP URL: public links pass through; local files upload to temp OSS.
 */
export async function resolveDingTalkShareUrl(filePath: string, fileName: string): Promise<string> {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error('分享文件路径为空');
  }
  if (isHttpUrl(trimmed)) {
    return trimmed;
  }
  return uploadFileToTempOSS(trimmed, fileName.trim() || 'file');
}

export async function confirmDingTalkShare(draft: DingTalkShareDialogDraft): Promise<void> {
  if (draft.kind === 'artifact') {
    const url = await resolveDingTalkShareUrl(draft.filePath, draft.fileName);
    await shareToDingTalk({
      title: draft.title,
      text: `请查看产物：${draft.fileName}`,
      url,
    });
    return;
  }

  let shareUrl: string | undefined;
  if (draft.artifact) {
    shareUrl = await resolveDingTalkShareUrl(draft.artifact.filePath, draft.artifact.fileName);
  }

  const bodyText = draft.fullText || draft.textPreview;
  await shareToDingTalk({
    title: draft.artifact?.title ?? '分享对话',
    text: bodyText || (shareUrl ? `请查看产物：${draft.artifact!.fileName}` : ''),
    url: shareUrl,
  });
}

/**
 * @deprecated Use buildArtifactShareDialogDraft
 */
export function buildArtifactShareDraft(file: {
  fileName: string;
  filePath: string;
}): ArtifactShareDraft {
  const fileName = file.fileName.trim() || '产物';
  const url = isHttpUrl(file.filePath.trim()) ? file.filePath.trim() : '';
  const baseTitle = displayArtifactTitle(fileName);
  return {
    title: baseTitle,
    text: `请查看产物：${fileName}`,
    url,
    isLocalServeUrl: !isHttpUrl(file.filePath.trim()),
  };
}

/**
 * Build DingTalk AppLink URL for PC client employee picker (no side effects).
 */
export function prepareDingTalkShare(
  content: DingTalkShareContent,
): DingTalkShareBuildResult {
  const built = buildDingTalkShareAppLinkUrl(content);
  assertDingTalkShareOpenUrl(built.url);
  return built;
}

/**
 * Open DingTalk share picker with prefilled text / link / image URLs.
 * Uses Electron shell.openExternal via preload IPC.
 */
export async function shareToDingTalk(content: DingTalkShareContent): Promise<DingTalkShareBuildResult> {
  const built = prepareDingTalkShare(content);
  const electron = window.electron;
  if (!electron?.openExternal) {
    throw new Error('当前环境无法打开外部链接');
  }
  await electron.openExternal(built.url);
  return built;
}
