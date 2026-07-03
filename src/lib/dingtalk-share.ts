import {
  assertDingTalkShareOpenUrl,
  buildDingTalkShareAppLinkUrl,
  buildDingTalkShareDefaultMsg,
  DINGTALK_SHARE_MAX_URL_LENGTH,
  type DingTalkShareBuildResult,
  type DingTalkShareContent,
} from '../../shared/dingtalk-share';
import {
  buildSharePathToUrlMap,
  replaceConversationFileRefsWithShareUrls,
} from '../../shared/dingtalk-share-text';
import { markdownToPlainText } from '../../shared/markdown-to-plain-text';
import { hostApiFetch, uploadFileToTempOSS } from '@/lib/host-api';
import { isHttpUrl } from '@/lib/preview-url';
import type { AttachedFileMeta } from '@/stores/chat';
import {
  buildArtifactMetaLine,
  formatArtifactFileSize,
} from '@/components/chat/artifact-product-card';

export type { DingTalkShareBuildResult, DingTalkShareContent };
export { DINGTALK_SHARE_MAX_URL_LENGTH };
export { markdownToPlainText } from '../../shared/markdown-to-plain-text';

export type DingTalkSharePrepared =
  | { status: 'ready'; content: DingTalkShareContent }
  | { status: 'too_long'; content: DingTalkShareContent; defaultMsg: string; title: string };

export function getDingTalkShareDefaultMsg(content: DingTalkShareContent): string {
  return buildDingTalkShareDefaultMsg(content).defaultMsg;
}

export function isDingTalkShareContentTooLong(content: DingTalkShareContent): boolean {
  return getDingTalkShareDefaultMsg(content).length > DINGTALK_SHARE_MAX_URL_LENGTH;
}

async function buildShareContentFromDraft(draft: DingTalkShareDialogDraft): Promise<DingTalkShareContent> {
  if (draft.kind === 'artifact') {
    const url = await resolveDingTalkShareUrl(draft.filePath, draft.fileName);
    return {
      title: draft.title,
      text: `请查看产物：${draft.fileName}`,
      url,
    };
  }

  const files = [...draft.files];
  if (draft.artifact && !files.some((file) => file.filePath === draft.artifact!.filePath)) {
    files.push({
      fileName: draft.artifact.fileName,
      filePath: draft.artifact.filePath,
    });
  }

  const bodyText = await buildConversationShareText(draft.fullText, files);
  return {
    title: draft.artifact?.title ?? '分享对话',
    text: bodyText,
  };
}

export async function prepareDingTalkShareFromDraft(
  draft: DingTalkShareDialogDraft,
): Promise<DingTalkSharePrepared> {
  logDingTalkShare('confirm-start', {
    kind: draft.kind,
    title: draft.kind === 'artifact' ? draft.title : draft.artifact?.title,
    fileName: draft.kind === 'artifact' ? draft.fileName : draft.artifact?.fileName,
    hasArtifact: draft.kind === 'conversation' ? Boolean(draft.artifact) : true,
  });

  const content = await buildShareContentFromDraft(draft);
  const defaultMsg = getDingTalkShareDefaultMsg(content);
  logDingTalkShare('prepare-share', {
    defaultMsgLength: defaultMsg.length,
    maxLength: DINGTALK_SHARE_MAX_URL_LENGTH,
    tooLong: defaultMsg.length > DINGTALK_SHARE_MAX_URL_LENGTH,
  });

  if (defaultMsg.length > DINGTALK_SHARE_MAX_URL_LENGTH) {
    return {
      status: 'too_long',
      content,
      defaultMsg,
      title: content.title ?? '分享',
    };
  }
  return { status: 'ready', content };
}

export async function openDingTalkShareAfterClipboardCopy(
  title: string,
  clipboardText: string,
  pickerHint: string,
): Promise<DingTalkShareBuildResult> {
  await navigator.clipboard.writeText(clipboardText);
  logDingTalkShare('clipboard-fallback', {
    defaultMsgLength: clipboardText.length,
    title,
  });
  return shareToDingTalk({ title, text: pickerHint });
}

function logDingTalkShare(stage: string, payload: Record<string, unknown>): void {
  const message = `[dingtalk-share] stage=${stage}`;
  const data = { stage, ...payload, timestamp: new Date().toISOString() };
  console.info(message, data);
  void hostApiFetch('/api/logs/client', {
    method: 'POST',
    body: JSON.stringify({ level: 'info', message, data }),
  }).catch(() => undefined);
}

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
      files: Array<{ fileName: string; filePath: string }>;
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
  const shareFiles = files
    .filter((file) => file.filePath.trim().length > 0)
    .map((file) => ({
      fileName: file.fileName.trim() || 'file',
      filePath: file.filePath.trim(),
    }));
  return {
    kind: 'conversation',
    textPreview: truncateConversationPreview(text),
    fullText: text.trim(),
    files: shareFiles,
    artifact: artifactFile
      ? buildArtifactDraftFields(artifactFile, t)
      : undefined,
  };
}

async function buildConversationShareText(
  fullText: string,
  files: Array<{ fileName: string; filePath: string }>,
): Promise<string> {
  const uniqueFiles = new Map<string, { fileName: string; filePath: string }>();
  for (const file of files) {
    const filePath = file.filePath.trim();
    if (!filePath || uniqueFiles.has(filePath)) continue;
    uniqueFiles.set(filePath, {
      fileName: file.fileName.trim() || 'file',
      filePath,
    });
  }

  const entries: Array<{ localPath: string; shareUrl: string }> = [];
  for (const file of uniqueFiles.values()) {
    const shareUrl = await resolveDingTalkShareUrl(file.filePath, file.fileName);
    entries.push({ localPath: file.filePath, shareUrl });
  }

  const pathToUrl = buildSharePathToUrlMap(entries);
  const replaced = replaceConversationFileRefsWithShareUrls(fullText, pathToUrl);
  const plainText = markdownToPlainText(replaced);
  logDingTalkShare('replace-file-refs', {
    fileCount: entries.length,
    originalLength: fullText.length,
    replacedLength: replaced.length,
    plainTextLength: plainText.length,
    replacedPreview: plainText.slice(0, 320),
    replacementCount: entries.length,
  });
  return plainText;
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
    logDingTalkShare('resolve-url', { filePath: trimmed, fileName, source: 'http-direct' });
    return trimmed;
  }
  logDingTalkShare('resolve-url-start', { filePath: trimmed, fileName, source: 'oss-upload' });
  try {
    const uploaded = await uploadFileToTempOSS(trimmed, fileName.trim() || 'file', {
      source: 'dingtalk-share',
      includeDebugCurl: true,
    });
    logDingTalkShare('resolve-url-done', {
      filePath: trimmed,
      fileName,
      tempUrl: uploaded.url,
      ossKey: uploaded.ossKey,
      resourceId: uploaded.resourceId,
      ossUploadCurl: uploaded.debugCurl,
    });
    return uploaded.url;
  } catch (error) {
    logDingTalkShare('resolve-url-failed', {
      filePath: trimmed,
      fileName,
      error: error instanceof Error ? error.message : String(error),
      hint: 'See Main log for [dingtalk-share] oss-upload curl',
    });
    throw error;
  }
}

export async function confirmDingTalkShare(draft: DingTalkShareDialogDraft): Promise<DingTalkShareBuildResult> {
  const prepared = await prepareDingTalkShareFromDraft(draft);
  if (prepared.status === 'too_long') {
    throw new Error('分享内容超过字符上限，请使用超长内容确认流程');
  }
  return shareToDingTalk(prepared.content);
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
export function prepareDingTalkShare(content: DingTalkShareContent): DingTalkShareBuildResult {
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
  logDingTalkShare('open-external', {
    title: content.title,
    textLength: content.text?.length ?? 0,
    shareUrl: content.url,
    defaultMsgLength: built.defaultMsg.length,
    defaultMsgPreview: built.defaultMsg.slice(0, 320),
    containsInlineOssLink: /\[([^\]]+)\]\(https?:\/\//.test(built.defaultMsg),
    truncated: built.truncated,
    warnings: built.warnings,
    openUrlLength: built.url.length,
  });
  const electron = window.electron;
  if (!electron?.openExternal) {
    throw new Error('当前环境无法打开外部链接');
  }
  await electron.openExternal(built.url);
  return built;
}
