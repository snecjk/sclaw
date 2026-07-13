import { invokeIpc } from '@/lib/api-client';
import { writeCopyShareFilesToClipboard, writePlainTextToClipboard } from '@/lib/copy-share-clipboard';
import { isHttpUrl, openExternalUrl } from '@/lib/preview-url';
import type { AttachedFileMeta } from '@/stores/chat';

export interface ArtifactCardMenuItem {
  id: string;
  label: string;
  onSelect: () => void | Promise<void | number>;
}

export function buildArtifactCardMenuItems(
  file: Pick<AttachedFileMeta, 'filePath' | 'downloadUrl' | 'fileName' | 'mimeType' | 'fileSize' | 'preview'>,
  t: (key: string) => string,
): ArtifactCardMenuItem[] {
  const filePath = file.filePath?.trim();
  if (!filePath) return [];

  if (isHttpUrl(filePath)) {
    const downloadTarget = file.downloadUrl?.trim() || filePath;
    return [
      {
        id: 'download',
        label: t('preview.download'),
        onSelect: () => openExternalUrl(downloadTarget),
      },
      {
        id: 'copyLink',
        label: t('artifact.copyLink'),
        onSelect: async () => {
          await writePlainTextToClipboard(filePath);
        },
      },
    ];
  }

  return [
    {
      id: 'showInFolder',
      label: t('artifact.openFileLocation'),
      onSelect: () => invokeIpc('shell:showItemInFolder', filePath),
    },
    {
      id: 'copyFile',
      label: t('artifact.copyFile'),
      onSelect: async () => writeCopyShareFilesToClipboard({
        files: [file as AttachedFileMeta],
      }),
    },
  ];
}
