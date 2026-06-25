import {
  assertDingTalkShareOpenUrl,
  buildDingTalkShareAppLinkUrl,
  type DingTalkShareBuildResult,
  type DingTalkShareContent,
} from '../../shared/dingtalk-share';
import { getHostApiBase } from '@/lib/host-api';
import { isHttpUrl } from '@/lib/preview-url';

export type { DingTalkShareBuildResult, DingTalkShareContent };

export type ArtifactShareDraft = {
  title: string;
  text: string;
  url: string;
  /** True when url points at local Host API serve (may not work for remote recipients). */
  isLocalServeUrl: boolean;
};

/**
 * Resolve a shareable HTTP URL for an artifact preview file.
 */
export function resolveArtifactShareUrl(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return '';
  if (isHttpUrl(trimmed)) return trimmed;
  return `${getHostApiBase()}/api/files/serve?path=${encodeURIComponent(trimmed)}`;
}

/**
 * Default title / body / link for artifact share confirmation dialog.
 */
export function buildArtifactShareDraft(file: {
  fileName: string;
  filePath: string;
}): ArtifactShareDraft {
  const fileName = file.fileName.trim() || '产物';
  const url = resolveArtifactShareUrl(file.filePath);
  const baseTitle = fileName.replace(/\.[^.]+$/, '') || fileName;
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
